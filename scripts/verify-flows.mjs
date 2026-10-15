import { spawn } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { loadConfig } from '../packages/core/src/config.js';
import { evaluateStrictSuiteResult, parseTestSummary } from './verification-profile.mjs';

const root = resolve(import.meta.dirname, '..');
const config = loadConfig(process.env);
if (process.env.YUNCMS_TEST_MYSQL !== '1' || process.env.YUNCMS_TEST_DB_ALLOW_DESTRUCTIVE !== '1' || !/(test|ci|dev)/i.test(config.database.database)) {
  console.error('Flow acceptance requires YUNCMS_TEST_MYSQL=1, YUNCMS_TEST_DB_ALLOW_DESTRUCTIVE=1 and a disposable DB_DATABASE containing test, ci or dev. No tests were started.');
  process.exit(1);
}
const output = resolve(root, '.yuncms/flows-tests/acceptance');
await mkdir(output, { recursive: true });
const report = { startedAt: new Date().toISOString(), node: process.version, success: false, phases: [] };
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
async function run(name, command, args, tests = false) {
  console.log(`Flow acceptance: ${name}`);
  let log = '';
  const code = await new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: root, env: { ...process.env, FORCE_COLOR: '0' }, stdio: ['ignore', 'pipe', 'pipe'] });
    child.stdout.on('data', bytes => { log += bytes; }); child.stderr.on('data', bytes => { log += bytes; });
    child.once('error', reject); child.once('exit', code => resolve(code));
  });
  await writeFile(resolve(output, `${name}.log`), log);
  const summary = tests ? parseTestSummary(log) : null;
  const result = tests ? evaluateStrictSuiteResult(code, summary) : { ok: code === 0 };
  report.phases.push({ name, exitCode: code, ...(summary ? { summary } : {}), success: result.ok });
  if (!result.ok) throw Error(`${name}: ${result.reason ?? 'command failed'}; inspect ${output}/${name}.log`);
}
try {
  await run('unit', process.execPath, ['--test', '--test-reporter=tap',
    'packages/core/test/flows.test.js', 'packages/core/test/flow-script.test.js', 'packages/core/test/flow-verification.test.js', 'packages/core/test/studio-schema-service.test.js',
    'packages/api/test/flows.test.js', 'apps/studio/test/flows.test.js', 'apps/studio/test/content-access.test.js', 'apps/studio/test/field-ui.test.js'], true);
  await run('build', npm, ['run', 'build:studio']);
  // Keep native and browser fixtures sequential: they must never consume each other's queue jobs.
  await run('mysql', process.execPath, ['--test', '--test-reporter=tap', 'test/integration/flows.test.js'], true);
  await run('browser', npm, ['run', 'test:browser']);
  const browser = JSON.parse(await readFile(resolve(root, '.yuncms/flows-tests/browser-results.json'), 'utf8')).stats;
  report.browser = browser;
  if (!browser.expected || browser.unexpected || browser.flaky || browser.skipped) throw Error('Browser acceptance requires executed tests with zero failures, retries or skips');
  report.success = true;
  console.log(`Flow acceptance passed: ${browser.expected} browser scenarios, real MySQL/network/process execution, zero skips.`);
} catch (error) { console.error(error.message); process.exitCode = 1; }
finally { report.finishedAt = new Date().toISOString(); await writeFile(resolve(output, 'report.json'), JSON.stringify(report, null, 2) + '\n'); }
