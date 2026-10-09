import assert from 'node:assert/strict';
import test from 'node:test';

import { HookEmitter } from '../src/hooks.js';
import { ItemsService } from '../src/services/items-service.js';

const schema = {
  collections: {
    articles: {
      collection: 'articles',
      primary_key: 'id',
      system: false,
      fields: {
        id: { field: 'id', type: 'uuid' },
        title: { field: 'title', type: 'string' },
        secret: { field: 'secret', type: 'string' },
      },
    },
  },
};

function databaseFor(rows = []) {
  const calls = [];
  return {
    calls,
    async query(sql, params) {
      calls.push({ sql, params });
      if (/COUNT\(\*\) AS total_count/.test(sql)) return [[{ total_count: rows.length }]];
      return [rows];
    },
  };
}

class TestItemsService extends ItemsService {
  async resolvePermission() {
    return { action: 'read', fields: ['id', 'title'], filter: null, validation: null };
  }
}

test('items.query is revalidated after hook transformation and cannot select forbidden fields', async () => {
  const emitter = new HookEmitter();
  emitter.registerFilter('items.query', (query) => ({ ...query, fields: ['secret'] }));
  const database = databaseFor([]);
  const service = new TestItemsService('articles', { database, schema, emitter, accountability: { role: 'r1' } });

  await assert.rejects(() => service.readManyWithMeta({ fields: 'title' }), /Unknown field: secret/);
  assert.equal(database.calls.length, 0);
});

test('items.read action receives bounded metadata rather than response payloads', async () => {
  const events = [];
  const emitter = new HookEmitter();
  emitter.registerAction('items.read', (payload) => events.push(payload));
  const database = databaseFor([{ id: '1', title: 'A' }]);
  const service = new TestItemsService('articles', { database, schema, emitter, accountability: { role: 'r1' } });

  await service.readManyWithMeta({ search: 'A' });
  assert.equal(events.length, 1);
  assert.deepEqual(events[0].keys, ['1']);
  assert.equal(events[0].count, 1);
  assert.equal(Object.hasOwn(events[0], 'data'), false);
});

test('single reads combine query-hook constraints with native permissions and an immutable requested key', async () => {
  const emitter = new HookEmitter();
  let context;
  emitter.registerFilter('items.query', (query, hookContext) => {
    context = hookContext;
    return { ...query, filter: { title: { _eq: 'Visible' } }, fields: ['title'], search: 'Visible' };
  });
  const database = databaseFor([{ title: 'Visible' }]);
  const service = new TestItemsService('articles', { database, schema, emitter, accountability: { role: 'r1' } });
  service.resolvePermission = async () => ({ fields: ['title'], filter: { secret: { _eq: 'allowed' } } });

  assert.deepEqual(await service.readOne('requested-id'), { title: 'Visible' });
  assert.equal(context.single, true);
  assert.equal(context.key, 'requested-id');
  assert.equal(context.operation, 'read');
  assert.match(database.calls[0].sql, /^SELECT `title` FROM `articles`/);
  assert.match(database.calls[0].sql, /`secret` = \?/);
  assert.match(database.calls[0].sql, /`title` = \?/);
  assert.match(database.calls[0].sql, /`title` LIKE \?/);
  assert.match(database.calls[0].sql, /`id` = \?/);
  assert.deepEqual(database.calls[0].params, ['allowed', 'Visible', '%Visible%', 'requested-id']);
});

test('single-read hooks cannot redirect the requested key and denied records emit no read action', async () => {
  const emitter = new HookEmitter();
  const events = [];
  emitter.registerFilter('items.query', (query) => ({ ...query, filter: { id: { _eq: 'another-id' } } }));
  emitter.registerAction('items.read', (payload) => events.push(payload));
  const database = databaseFor([]);
  const service = new TestItemsService('articles', { database, schema, emitter, accountability: { role: 'r1' } });

  assert.equal(await service.readOne('requested-id'), null);
  assert.deepEqual(database.calls[0].params, ['another-id', 'requested-id']);
  assert.equal(events.length, 0);
});

for (const transformed of [
  { fields: ['secret'] },
  { filter: { secret: { _eq: 'hidden' } } },
  { limit: true },
  { aggregate: { count: ['id'] } },
]) {
  test(`single reads reject invalid or forbidden hook output: ${JSON.stringify(transformed)}`, async () => {
    const emitter = new HookEmitter();
    emitter.registerFilter('items.query', (query) => ({ ...query, ...transformed }));
    const database = databaseFor([]);
    const service = new TestItemsService('articles', { database, schema, emitter, accountability: { role: 'r1' } });

    await assert.rejects(() => service.readOne('1'), (error) => error.code === 'INVALID_QUERY');
    assert.equal(database.calls.length, 0);
  });
}

test('successful single reads emit the transformed query and bounded single-record metadata', async () => {
  const emitter = new HookEmitter();
  const events = [];
  emitter.registerFilter('items.query', (query) => ({ ...query, filter: { title: { _eq: 'Visible' } } }));
  emitter.registerAction('items.read', (payload) => events.push(payload));
  const database = databaseFor([{ id: '1', title: 'Visible' }]);
  const service = new TestItemsService('articles', { database, schema, emitter, accountability: { role: 'r1' } });

  await service.readOne('1');
  assert.equal(events.length, 1);
  assert.equal(events[0].single, true);
  assert.equal(events[0].count, 1);
  assert.deepEqual(events[0].keys, ['1']);
  assert.deepEqual(events[0].query.filter, { title: { _eq: 'Visible' } });
  assert.equal(Object.hasOwn(events[0], 'data'), false);
});
