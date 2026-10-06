import assert from 'node:assert/strict';
import test from 'node:test';
import { createPublicAccountability, createSystemAccountability } from '../src/accountability.js';
import { HookEmitter } from '../src/hooks.js';
import { ItemsService } from '../src/services/items-service.js';
import { withConnectionTransaction, withTransaction } from '../src/transaction.js';

const schema = { collections: { projects: {
  collection: 'projects', primary_key: 'id', fields: {
    id: { field: 'id', type: 'uuid', readonly: 1, required: 1 },
    title: { field: 'title', type: 'string', required: 1 },
  },
} } };

function fixture() {
  const calls = [];
  const events = [];
  const connection = {
    async beginTransaction() { calls.push('begin'); },
    async commit() { calls.push('commit'); },
    async rollback() { calls.push('rollback'); },
    release() { calls.push('release'); },
    async query(sql) {
      if (sql.startsWith('SELECT')) return [[{ id: 'project-1', title: 'Demo' }]];
      return [{ affectedRows: 1 }];
    },
  };
  const pool = { getConnection: async () => connection, query: connection.query };
  const emitter = new HookEmitter();
  for (const event of ['items.create', 'items.update', 'items.delete']) {
    emitter.registerAction(event, (payload, context) => {
      calls.push(event);
      events.push({ event, payload, context });
    });
  }
  const items = database => new ItemsService('projects', {
    database, schema, emitter, accountability: createSystemAccountability(), requestId: 'transaction-test',
  });
  return { calls, events, connection, pool, emitter, items };
}

const mutations = {
  createOne: items => items.createOne({ title: 'Demo' }),
  createMany: items => items.createMany([{ title: 'One' }, { title: 'Two' }]),
  updateOne: items => items.updateOne('project-1', { title: 'Changed' }),
  updateMany: items => items.updateMany({ title: { _eq: 'Demo' } }, { title: 'Changed' }),
  deleteOne: items => items.deleteOne('project-1'),
  deleteMany: items => items.deleteMany({ title: { _eq: 'Demo' } }),
};

for (const [name, mutate] of Object.entries(mutations)) {
  test(`${name} actions wait for the outer commit and are discarded on rollback`, async () => {
    const committed = fixture();
    await withTransaction(committed.pool, async connection => {
      await mutate(committed.items(connection));
      assert.equal(committed.events.length, 0, 'no success action before commit');
    });
    assert.ok(committed.events.length > 0);
    assert.deepEqual(committed.calls.slice(0, 3), ['begin', 'commit', 'release']);
    for (const { context } of committed.events) {
      assert.equal(context.database, committed.pool);
      assert.deepEqual(context.transaction, { managed: true, state: 'committed' });
      assert.equal(context.requestId, 'transaction-test');
    }

    const rolledBack = fixture();
    await assert.rejects(withTransaction(rolledBack.pool, async connection => {
      await mutate(rolledBack.items(connection));
      throw new Error('later operation failed');
    }), /later operation failed/);
    assert.equal(rolledBack.events.length, 0);
    assert.deepEqual(rolledBack.calls, ['begin', 'rollback', 'release']);
  });
}

test('filters remain inside the transaction and post-commit payloads are captured at mutation time', async () => {
  const f = fixture();
  f.emitter.registerFilter('items.create', (payload, context) => {
    assert.equal(context.database, f.connection);
    assert.deepEqual(context.transaction, { managed: true, state: 'active' });
    return payload;
  });
  await withTransaction(f.pool, async connection => {
    const returned = await f.items(connection).createOne({ title: 'Demo' });
    returned.title = 'changed after mutation';
  });
  assert.equal(f.events[0].payload.item.title, 'Demo');
});

test('connection-owned nested transactions join without committing or releasing the caller connection', async () => {
  const f = fixture();
  await withConnectionTransaction(f.connection, async connection => {
    await withTransaction(connection, async joined => {
      assert.equal(joined, connection);
      await f.items(joined).createOne({ title: 'Demo' });
    });
    assert.equal(f.events.length, 0);
  });
  assert.deepEqual(f.calls, ['begin', 'commit', 'items.create']);
  assert.equal(f.events[0].context.database, f.connection);
});

test('commit failure discards actions and action failure never rolls back a committed mutation', async () => {
  const f = fixture();
  f.connection.commit = async () => { throw new Error('commit failed'); };
  await assert.rejects(withTransaction(f.pool, connection => f.items(connection).createOne({ title: 'Demo' })), /commit failed/);
  assert.equal(f.events.length, 0);
  assert.deepEqual(f.calls, ['begin', 'rollback', 'release']);

  const committed = fixture();
  committed.emitter.action = async (event) => {
    if (event === 'items.create') throw new Error('post-commit failure');
  };
  await assert.rejects(withTransaction(committed.pool, connection => committed.items(connection).createOne({ title: 'Demo' })), /post-commit failure/);
  assert.deepEqual(committed.calls, ['begin', 'commit', 'release']);
});

test('transactions preserve deny-by-default authorization and ordinary autocommit actions', async () => {
  const f = fixture();
  await assert.rejects(withTransaction(f.pool, connection => new ItemsService('projects', {
    database: connection, schema, emitter: f.emitter, accountability: createPublicAccountability(),
  }).createOne({ title: 'Denied' })), error => error.code === 'FORBIDDEN');
  assert.equal(f.events.length, 0);
  await f.items(f.pool).createOne({ title: 'Demo' });
  assert.equal(f.events.length, 1);
  assert.equal(f.events[0].context.transaction, null);
});

test('deferred actions stay isolated across concurrent connections and a reused rolled-back connection', async () => {
  const first = fixture();
  const second = fixture();
  let continueFirst;
  const gate = new Promise(resolve => { continueFirst = resolve; });
  let firstMutation;
  const mutated = new Promise(resolve => { firstMutation = resolve; });
  const pending = withTransaction(first.pool, async connection => {
    await first.items(connection).createOne({ title: 'First' });
    firstMutation();
    await gate;
    throw new Error('first rollback');
  });
  const rejected = assert.rejects(pending, /first rollback/);
  await mutated;
  await withTransaction(second.pool, connection => second.items(connection).createOne({ title: 'Second' }));
  assert.equal(first.events.length, 0);
  assert.equal(second.events.length, 1);
  continueFirst();
  await rejected;
  await withTransaction(first.pool, connection => first.items(connection).createOne({ title: 'After rollback' }));
  assert.equal(first.events.length, 1);
});

test('nested isolation changes fail without beginning another transaction', async () => {
  const f = fixture();
  await assert.rejects(withTransaction(f.pool, connection => withConnectionTransaction(
    connection, async () => {}, { isolationLevel: 'SERIALIZABLE' },
  )), /cannot change the outer isolation level/);
  assert.deepEqual(f.calls, ['begin', 'rollback', 'release']);
});
