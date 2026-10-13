import assert from 'node:assert/strict';
import test from 'node:test';
import { databaseAdvisoryLockName, withAdvisoryLock } from '../src/advisory-lock.js';

test('database lock names isolate databases and purposes while staying within MySQL limits', () => {
  const name = databaseAdvisoryLockName('project_test', 'yuncms:schema');
  assert.equal(name, databaseAdvisoryLockName('project_test', 'yuncms:schema'));
  assert.notEqual(name, databaseAdvisoryLockName('other_test', 'yuncms:schema'));
  assert.notEqual(name, databaseAdvisoryLockName('project_test', 'yuncms:bootstrap'));
  assert.ok(Buffer.byteLength(databaseAdvisoryLockName('測'.repeat(64), 'x'.repeat(200))) <= 64);
  for (const value of [null, '', 123]) assert.throws(() => databaseAdvisoryLockName(value, 'schema'), TypeError);
});

test('native pool lock acquisition and release use the same configured database scope', async () => {
  const calls = [], connection = { connection: { config: { database: 'project_test' } }, release() { calls.push('release'); }, async query(sql, values) { calls.push({ sql, values }); return [[{ acquired: 1 }]]; } };
  await withAdvisoryLock({ getConnection: async () => connection }, 'yuncms:schema', async db => { assert.equal(db, connection); });
  const expected = databaseAdvisoryLockName('project_test', 'yuncms:schema');
  assert.equal(calls[0].values[0], expected); assert.equal(calls[1].values[0], expected); assert.equal(calls[2], 'release');
});
