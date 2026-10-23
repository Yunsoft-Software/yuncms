import assert from 'node:assert/strict';
import test from 'node:test';
import { activeAdvisoryLockConnection, databaseAdvisoryLockName, withAdvisoryLock } from '../src/advisory-lock.js';
import { withTransaction } from '../src/transaction.js';

test('database lock names isolate databases and purposes while staying within MySQL limits', () => {
  const name = databaseAdvisoryLockName('project_test', 'yuncms:schema');
  assert.equal(name, databaseAdvisoryLockName('project_test', 'yuncms:schema'));
  assert.notEqual(name, databaseAdvisoryLockName('other_test', 'yuncms:schema'));
  assert.notEqual(name, databaseAdvisoryLockName('project_test', 'yuncms:bootstrap'));
  assert.ok(Buffer.byteLength(databaseAdvisoryLockName('測'.repeat(64), 'x'.repeat(200))) <= 64);
  for (const value of [null, '', 123]) assert.throws(() => databaseAdvisoryLockName(value, 'schema'), TypeError);
});

test('connection-owned advisory locks last until outer commit or rollback without releasing ownership', async () => {
  for (const rollback of [false, true]) {
    const calls = [], connection = {
      connection: { config: { database: 'project_test' } },
      async beginTransaction() { calls.push('begin'); }, async commit() { calls.push('commit'); }, async rollback() { calls.push('rollback'); },
      release() { assert.fail('caller owns connection'); },
      async query(sql) { calls.push(sql.includes('GET_LOCK') ? 'lock' : 'unlock'); return [[{ acquired: 1 }]]; },
    };
    const operation = withTransaction(connection, async db => { await withAdvisoryLock(db, 'schema', async () => {}); assert.deepEqual(calls, ['begin', 'lock']); if (rollback) throw Error('rollback'); });
    if (rollback) await assert.rejects(operation, /rollback/); else await operation;
    assert.deepEqual(calls, ['begin', 'lock', rollback ? 'rollback' : 'commit', 'unlock']);
  }
});

test('native pool lock acquisition and release use the same configured database scope', async () => {
  const calls = [], connection = { connection: { config: { database: 'project_test' } }, release() { calls.push('release'); }, async query(sql, values) { calls.push({ sql, values }); return [[{ acquired: 1 }]]; } };
  const pool = { getConnection: async () => connection };
  assert.equal(activeAdvisoryLockConnection(pool), pool);
  let releaseDetached;
  const gate = new Promise((resolve) => { releaseDetached = resolve; });
  let detachedTask;
  await withAdvisoryLock(pool, 'yuncms:schema', async db => {
    assert.equal(db, connection);
    assert.equal(activeAdvisoryLockConnection(pool), connection);
    detachedTask = (async () => {
      await gate;
      return activeAdvisoryLockConnection(pool);
    })();
  });
  assert.equal(activeAdvisoryLockConnection(pool), pool);
  releaseDetached();
  assert.equal(await detachedTask, pool, 'detached async work must not reuse a released advisory lock connection');
  const expected = databaseAdvisoryLockName('project_test', 'yuncms:schema');
  assert.equal(calls[0].values[0], expected); assert.equal(calls[1].values[0], expected); assert.equal(calls[2], 'release');
});
