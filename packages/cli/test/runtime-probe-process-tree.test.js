import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { verifyInstalledRuntime } from '../src/runtime-probe.js';

test('probe escalation kills a real CLI and its unresponsive API descendant', {
  skip: process.platform === 'win32', timeout: 10_000,
}, async () => {
  const cwd = await mkdtemp(join(tmpdir(), 'yuncms-probe-tree-'));
  const reservation = createServer();
  await new Promise(resolve => reservation.listen(0, '127.0.0.1', resolve));
  const port = reservation.address().port;
  await new Promise(resolve => reservation.close(resolve));
  const bin = join(cwd, 'node_modules', '@yunsoft', 'yuncms', 'bin');
  try {
    await mkdir(bin, { recursive: true });
    await writeFile(join(bin, 'yuncms.js'), `
const { spawn } = require('node:child_process');
const api = spawn(process.execPath, ['-e', ${JSON.stringify(`
require('node:http').createServer((req, res) => {
  res.setHeader('content-type', 'application/json');
  res.end(JSON.stringify({ status: 'ready' }));
}).listen(Number(process.env.PORT), '127.0.0.1');
process.on('SIGTERM', () => {});
`)}], { stdio: 'ignore', detached: false });
process.on('SIGTERM', () => {});
api.on('exit', () => process.exit(0));
`);
    await assert.rejects(verifyInstalledRuntime({ cwd, port, shutdownGraceMs: 100 }),
      error => error.code === 'UPDATE_PROBE_SHUTDOWN_FAILED' && error.signal === 'SIGKILL');
    await assert.rejects(fetch(`http://127.0.0.1:${port}/ready`));
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});
