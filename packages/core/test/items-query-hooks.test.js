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
