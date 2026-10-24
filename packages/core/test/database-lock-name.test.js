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
      async query(sql) { calls.push(sql.includes('GET_LOCK') ? 'lock' : 'unlock'); return [[sql.includes('GET_LOCK') ? { acquired: 1 } : { released: 1 }]]; },
    };
    const operation = withTransaction(connection, async db => { await withAdvisoryLock(db, 'schema', async () => {}); assert.deepEqual(calls, ['begin', 'lock']); if (rollback) throw Error('rollback'); });
    if (rollback) await assert.rejects(operation, /rollback/); else await operation;
    assert.deepEqual(calls, ['begin', 'lock', rollback ? 'rollback' : 'commit', 'unlock']);
  }
});

test('native pool lock acquisition and release use the same configured database scope', async () => {
  const calls = [], connection = { connection: { config: { database: 'project_test' } }, release() { calls.push('release'); }, async query(sql, values) { calls.push({ sql, values }); return [[sql.includes('GET_LOCK') ? { acquired: 1 } : { released: 1 }]]; } };
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

test('withAdvisoryLock destroys pooled connections instead of releasing when RELEASE_LOCK or GET_LOCK fails (#97)', async () => {
  for (const outcome of [1, 0, null, 'throw']) {
    let released = 0, destroyed = 0;
    const connection = {
      connection: { config: { database: 'project_test' } },
      release() { released += 1; },
      destroy() { destroyed += 1; },
      async query(sql) {
        if (sql.includes('GET_LOCK')) return [[{ acquired: 1 }]];
        if (sql.includes('RELEASE_LOCK')) {
          if (outcome === 'throw') throw new Error('unlock timeout');
          return [[{ released: outcome }]];
        }
        return [[{ ok: 1 }]];
      },
    };
    const pool = { getConnection: async () => connection };
    const result = await withAdvisoryLock(pool, `lock-${outcome}`, async () => 'done');
    assert.equal(result, 'done');
    if (outcome === 1) {
      assert.equal(released, 1);
      assert.equal(destroyed, 0);
    } else {
      assert.equal(released, 0, `RELEASE_LOCK outcome ${outcome} must not recycle connection into pool`);
      assert.equal(destroyed, 1, `RELEASE_LOCK outcome ${outcome} must destroy connection`);
    }
  }

  for (const unlockOutcome of [1, 0, 'throw']) {
    let released = 0, destroyed = 0;
    const connection = {
      connection: {
        config: { database: 'project_test' },
        destroy() { destroyed += 1; },
      },
      release() { released += 1; },
      async query(sql) {
        if (sql.includes('GET_LOCK')) return [[{ acquired: 1 }]];
        if (unlockOutcome === 'throw') throw new Error('unlock transport lost');
        return [[{ released: unlockOutcome }]];
      },
    };
    const pool = { getConnection: async () => connection };
    await assert.rejects(
      withAdvisoryLock(pool, 'failing-op', async () => { throw new Error('operation failed'); }),
      /operation failed/,
    );
    assert.equal(released, unlockOutcome === 1 ? 1 : 0);
    assert.equal(destroyed, unlockOutcome === 1 ? 0 : 1);
  }

  {
    let released = 0, destroyed = 0;
    const connection = {
      connection: { config: { database: 'project_test' } },
      release() { released += 1; },
      destroy() { destroyed += 1; },
      async query() { throw new Error('get_lock packet timeout'); },
    };
    const pool = { getConnection: async () => connection };
    await assert.rejects(withAdvisoryLock(pool, 'uncertain-acquire', async () => 'unreachable'), /get_lock packet timeout/);
    assert.equal(released, 0, 'uncertain GET_LOCK must destroy connection without releasing');
    assert.equal(destroyed, 1);
  }

  {
    let released = 0, destroyed = 0;
    const connection = {
      connection: { config: { database: 'project_test' } },
      async beginTransaction() {},
      async commit() {},
      async rollback() {},
      release() { released += 1; },
      destroy() { destroyed += 1; },
      async query(sql) {
        if (sql.includes('GET_LOCK')) return [[{ acquired: 1 }]];
        return [[{ released: 0 }]];
      },
    };
    const pool = { getConnection: async () => connection };
    await withTransaction(pool, async (db) => {
      await withAdvisoryLock(db, 'tx-lock', async () => {});
    });
    assert.equal(released, 0, 'withTransaction must not release a connection destroyed by failed deferred RELEASE_LOCK');
    assert.equal(destroyed, 1);
  }
});
