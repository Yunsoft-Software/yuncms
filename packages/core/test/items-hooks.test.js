import test from 'node:test';
import assert from 'node:assert/strict';

import { createSystemAccountability } from '../src/accountability.js';
import { HookEmitter } from '../src/hooks.js';
import { ItemsService } from '../src/services/items-service.js';

const schema = {
  version: 1,
  collections: {
    articles: {
      collection: 'articles',
      primary_key: 'id',
      fields: {
        id: { field: 'id', type: 'uuid', required: 1, readonly: 1, schema_metadata: { primaryKey: true } },
        title: { field: 'title', type: 'string', required: 1, readonly: 0, schema_metadata: {} },
      },
    },
  },
};

function createDatabase() {
  const calls = [];
  return {
    calls,
    async query(sql, params = []) {
      const normalized = sql.replace(/\s+/g, ' ').trim();
      calls.push({ sql: normalized, params });
      if (normalized.startsWith('INSERT INTO `articles`')) return [{ affectedRows: 1 }, []];
      if (normalized.startsWith('SELECT `id`, `title` FROM `articles`')) {
        return [[{ id: params.at(-1), title: 'Normalized' }], []];
      }
      throw new Error(`Unexpected query: ${normalized}`);
    },
  };
}

test('items create filter runs before SQL and action runs after successful mutation', async () => {
  const database = createDatabase();
  const emitter = new HookEmitter();
  const events = [];

  emitter.registerFilter('items.create', (payload, context) => {
    events.push(`filter:${context.collection}`);
    return { ...payload, title: payload.title.trim() };
  });
  emitter.registerAction('items.create', (payload, context) => {
    events.push(`action:${context.collection}:${payload.key}`);
  });

  const service = new ItemsService('articles', {
    database,
    schema,
    emitter,
    accountability: createSystemAccountability(),
  });

  const created = await service.createOne({ title: '  Normalized  ' });
  assert.equal(created.title, 'Normalized');
  assert.equal(database.calls[0].sql.startsWith('INSERT INTO `articles`'), true);
  assert.equal(database.calls[0].params.at(-1), 'Normalized');
  assert.equal(events[0], 'filter:articles');
  assert.match(events[1], /^action:articles:/);
});

test('filter rejection prevents database mutation', async () => {
  const database = createDatabase();
  const emitter = new HookEmitter();
  emitter.registerFilter('items.create', () => {
    const error = new Error('blocked');
    error.code = 'HOOK_BLOCKED';
    throw error;
  });

  const service = new ItemsService('articles', {
    database,
    schema,
    emitter,
    accountability: createSystemAccountability(),
  });

  await assert.rejects(service.createOne({ title: 'Blocked' }), (error) => error.code === 'HOOK_BLOCKED');
  assert.equal(database.calls.length, 0);
});
