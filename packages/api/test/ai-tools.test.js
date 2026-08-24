import assert from 'node:assert/strict';
import test from 'node:test';

import {
  aiToolDefinitions,
  executeAiTool,
  safeAiToolError,
  serializeAiToolResult,
} from '../src/ai/tools.js';

function fakeRequest(ItemsService = class {}) {
  return {
    id: 'req-ai-1',
    accountability: { user: 'user-1', role: 'role-1', admin: false, system: false },
    context: {
      services: { ItemsService, PermissionsService: class {} },
      database: {},
      schema: { collections: {}, relationByManyField: new Map() },
      logger: console,
      emitter: null,
      storage: null,
      permissionCache: null,
    },
  };
}

test('AI assistant publishes read, write and delete tools only for the selected access mode', () => {
  const readOnly = aiToolDefinitions({ writesEnabled: false, maxItems: 25 });
  const writable = aiToolDefinitions({ writesEnabled: true, maxItems: 25 });
  const full = aiToolDefinitions({ writesEnabled: true, deletesEnabled: true, maxItems: 25 });
  assert.deepEqual(readOnly.map((entry) => entry.function.name), [
    'schema_list_collections',
    'schema_describe_collection',
    'items_read_many',
    'items_read_one',
  ]);
  assert.deepEqual(writable.slice(-2).map((entry) => entry.function.name), [
    'items_create',
    'items_update',
  ]);
  assert.equal(writable.some((entry) => entry.function.name === 'items_delete'), false);
  assert.deepEqual(full.slice(-3).map((entry) => entry.function.name), [
    'items_create',
    'items_update',
    'items_delete',
  ]);
  assert.equal(readOnly[2].function.parameters.properties.limit.maximum, 25);
});

test('AI delete tools require the separate full-access gate', async () => {
  await assert.rejects(
    () => executeAiTool(fakeRequest(), 'items_delete', {
      collection: 'articles',
      id: 'article-1',
    }, { writesEnabled: true, deletesEnabled: false }),
    (error) => error.code === 'AI_TOOL_FORBIDDEN',
  );
});

test('AI write tools are blocked server-side when write mode is disabled', async () => {
  await assert.rejects(
    () => executeAiTool(fakeRequest(), 'items_create', {
      collection: 'articles',
      data: { title: 'Hello' },
    }, { writesEnabled: false }),
    (error) => error.code === 'AI_TOOL_FORBIDDEN',
  );
});

test('AI write tools preserve the authenticated request accountability', async () => {
  let constructed = null;
  class ItemsService {
    constructor(collection, options) {
      constructed = { collection, options };
    }
    async createOne(data) {
      return { id: 'item-1', ...data };
    }
  }
  const req = fakeRequest(ItemsService);
  const result = await executeAiTool(req, 'items_create', {
    collection: 'articles',
    data: { title: 'Hello' },
  }, { writesEnabled: true });
  assert.equal(constructed.collection, 'articles');
  assert.equal(constructed.options.accountability, req.accountability);
  assert.deepEqual(result, { id: 'item-1', title: 'Hello' });
});

test('AI full access preserves accountability while executing a delete', async () => {
  let constructed = null;
  class ItemsService {
    constructor(collection, options) {
      constructed = { collection, options };
    }
    async deleteOne(id) {
      return id;
    }
  }
  const req = fakeRequest(ItemsService);
  const result = await executeAiTool(req, 'items_delete', {
    collection: 'articles',
    id: 'article-1',
  }, { writesEnabled: true, deletesEnabled: true });
  assert.equal(constructed.collection, 'articles');
  assert.equal(constructed.options.accountability, req.accountability);
  assert.deepEqual(result, { deleted: 'article-1' });
});

test('AI tool argument validation rejects model-generated unknown properties', async () => {
  await assert.rejects(
    () => executeAiTool(fakeRequest(), 'items_read_one', {
      collection: 'articles',
      id: '1',
      rawSql: 'DROP TABLE articles',
    }),
    (error) => error.code === 'AI_TOOL_ARGUMENTS_INVALID',
  );
});

test('AI tool results and unexpected failures are bounded before returning to the model', () => {
  const serialized = serializeAiToolResult({ text: 'x'.repeat(100) }, 20);
  assert.match(serialized, /AI_TOOL_RESULT_TOO_LARGE/);
  assert.deepEqual(safeAiToolError(new Error('database password secret')), {
    error: { code: 'INTERNAL_ERROR', message: 'Tool execution failed' },
  });
});
