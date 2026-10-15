import assert from 'node:assert/strict';
import test from 'node:test';
import { createAccountability } from '../src/accountability.js';
import { executeFlowScript, SCRIPT_DEFAULTS } from '../src/flows/script.js';
import { fork, execFileSync } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { setTimeout as delay } from 'node:timers/promises';

const context = overrides => ({ accountability: createAccountability({ user: 'script-user', role: 'normal-role' }), schema: { collections: {} },
  scripts: { ...SCRIPT_DEFAULTS, enabled: true, timeoutMs: 2000 }, ...overrides });

test('real script processes support native ESM, installed npm packages and typed input without source interpolation', async () => {
  const code = `import { createHash } from 'node:crypto';
import mysql from 'mysql2/promise';
export default async function (data, context) {
  const path = await import('node:path');
  return { digest: createHash('sha256').update('abc').digest('hex'), driver: typeof mysql.createPool,
    name: path.basename('/a/b'), input: data.value, literal: '{{ $trigger.missing }}', actor: context.accountability.user };
}`;
  const result = await executeFlowScript({ code, format: 'module' }, { value: [false, 42, null] }, context());
  assert.deepEqual(result, { digest: 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad', driver: 'function', name: 'b', input: [false, 42, null], literal: '{{ $trigger.missing }}', actor: 'script-user' });
});

test('real CommonJS scripts can require installed packages and export async functions', async () => {
  const result = await executeFlowScript({ format: 'commonjs', code: "const mysql = require('mysql2'); module.exports = async data => ({ query: mysql.format('SELECT ? AS value', [data.value]), result: data.value * 2 });" }, { value: 21 }, context());
  assert.deepEqual(result, { query: 'SELECT 21 AS value', result: 42 });
});

test('trusted scripts are explicitly disabled by default and invalid definitions fail before execution', async () => {
  await assert.rejects(executeFlowScript({ code: 'export default () => 1' }, {}, context({ scripts: SCRIPT_DEFAULTS })), { code: 'FLOW_SCRIPT_DISABLED' });
  for (const options of [{ code: '' }, { code: 'x', format: 'typescript' }, { code: 'x'.repeat(65537) }, { code: 'x', unexpected: true }]) await assert.rejects(executeFlowScript(options, {}, context()), { code: 'INVALID_FLOW' });
});

test('syntax, missing package, invalid export, circular output and oversized output fail in actual child processes', async () => {
  for (const [code, expected] of [
    ['export default function (', 'FLOW_SCRIPT_ERROR'],
    ["import missing from 'yuncms-does-not-exist-fixture'; export default () => missing;", 'ERR_MODULE_NOT_FOUND'],
    ['export default 42', 'FLOW_SCRIPT_EXPORT_INVALID'],
    ['export default () => { throw null; }', 'FLOW_SCRIPT_ERROR'],
    ["export default () => { throw 'script primitive'; }", 'FLOW_SCRIPT_ERROR'],
    ['export default () => { const a = {}; a.a = a; return a; }', 'FLOW_SCRIPT_ERROR'],
    ["export default () => 'x'.repeat(262145)", 'FLOW_OUTPUT_LIMIT'],
  ]) await assert.rejects(executeFlowScript({ code }, {}, context()), { code: expected });
});

test('CPU loops and explicit process exits cannot take down the parent and later scripts still execute', async () => {
  await assert.rejects(executeFlowScript({ code: 'export default () => { while (true) {} }' }, {}, context({ scripts: { enabled: true, timeoutMs: 300 } })), { code: 'FLOW_SCRIPT_TIMEOUT' });
  await assert.rejects(executeFlowScript({ code: 'export default () => process.exit(0)' }, {}, context()), { code: 'FLOW_SCRIPT_EXIT' });
  assert.equal(await executeFlowScript({ code: 'export default () => 42' }, {}, context()), 42);
});

test('actual script process slots enforce concurrency and recover after completion', async () => {
  const options = { code: 'export default async () => { await new Promise(resolve => setTimeout(resolve, 400)); return true; }' };
  const first = executeFlowScript(options, {}, context()), second = executeFlowScript(options, {}, context());
  await assert.rejects(executeFlowScript(options, {}, context()), { code: 'FLOW_SCRIPT_BUSY' });
  assert.deepEqual(await Promise.all([first, second]), [true, true]);
  assert.equal(await executeFlowScript({ code: 'export default () => 1' }, {}, context()), 1);
});

test('actual V8 heap exhaustion is contained in the script process and its slot is reusable', async () => {
  await assert.rejects(executeFlowScript({ code: "export default () => { const arrays = []; while (true) arrays.push(new Array(1000000).fill('memory-pressure')); }" }, {}, context({ scripts: { enabled: true, memoryMb: 32, timeoutMs: 30000 } })), { code: 'FLOW_SCRIPT_EXIT' });
  assert.equal(await executeFlowScript({ code: 'export default () => true' }, {}, context()), true);
});

test('an actual API-parent crash leaves no CPU-loop script process running', { skip: process.platform === 'win32', timeout: 15000 }, async t => {
  const root = await mkdtemp(join(tmpdir(), 'yuncms-script-orphan-')), pidFile = join(root, 'script.pid');
  const host = fork(new URL('../../../test/helpers/flow-script-host.mjs', import.meta.url), [pidFile, root], { execArgv: [], stdio: 'ignore' });
  let scriptPid;
  t.after(async () => { host.kill('SIGKILL'); if (scriptPid) { try { process.kill(scriptPid, 'SIGKILL'); } catch {} } await rm(root, { recursive: true, force: true }); });
  for (let attempt = 0; attempt < 100; attempt++) {
    try { scriptPid = Number(await readFile(pidFile, 'utf8')); break; } catch { await delay(25); }
  }
  assert.ok(scriptPid); const exited = new Promise(resolve => host.once('exit', resolve)); host.kill('SIGKILL'); await exited;
  const alive = () => { try { return !/^Z/.test(execFileSync('ps', ['-o', 'stat=', '-p', String(scriptPid)], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()); } catch { return false; } };
  for (let attempt = 0; attempt < 100 && alive(); attempt++) await delay(25);
  assert.equal(alive(), false, 'The independent watchdog must terminate orphaned CPU loops before the 10-second script deadline');
});
