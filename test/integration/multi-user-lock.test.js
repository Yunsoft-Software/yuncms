// Physical multi-user isolation integration test
// Tracks: https://github.com/Yunsoft-Software/yuncms/issues/44
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import test from 'node:test';

const ENABLED = process.env.YUNCMS_TEST_DOCKER === '1';
const ROOT = resolve(import.meta.dirname, '../..');

test('Multi-user update lock isolation and legacy probe under Docker (UID 10001 & 10002)', {
  skip: !ENABLED,
  timeout: 120_000,
}, () => {
  const result = spawnSync(
    'docker',
    [
      'run',
      '--rm',
      '-v',
      `${ROOT}:/workspace:ro`,
      '-w',
      '/workspace',
      'node:24-bookworm-slim',
      'node',
      'test/integration/fixtures/multi-user-lock-worker.mjs',
    ],
    {
      encoding: 'utf8',
      timeout: 100_000,
    },
  );

  if (result.status !== 0) {
    console.error('Docker multi-user test stdout:', result.stdout);
    console.error('Docker multi-user test stderr:', result.stderr);
  }

  assert.equal(result.status, 0, `Expected docker harness to succeed, got status ${result.status}`);
  assert.ok(result.stdout.includes('All 7 two-user multi-user lock scenarios PASSED'));
});
