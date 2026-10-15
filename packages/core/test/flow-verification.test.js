import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

test('the actual Flow acceptance command fails closed before starting tests without disposable database consent', () => {
  for (const overrides of [{ YUNCMS_TEST_MYSQL: '0' }, { YUNCMS_TEST_DB_ALLOW_DESTRUCTIVE: '0' }, { DB_DATABASE: 'production' }]) {
    const result = spawnSync(process.execPath, ['scripts/verify-flows.mjs'], { cwd: new URL('../../../', import.meta.url), env: {
      ...process.env, YUNCMS_TEST_MYSQL: '1', YUNCMS_TEST_DB_ALLOW_DESTRUCTIVE: '1', DB_DATABASE: 'flow_test', ...overrides,
    }, encoding: 'utf8' });
    assert.equal(result.status, 1); assert.match(result.stderr, /No tests were started/); assert.doesNotMatch(result.stdout, /Flow acceptance: unit/);
  }
});
