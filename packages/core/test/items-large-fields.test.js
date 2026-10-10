import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createAccountability,
  createSystemAccountability,
} from '../src/accountability.js';
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
        status: { field: 'status', type: 'string', required: 0, readonly: 0, schema_metadata: {} },
        tenant_id: { field: 'tenant_id', type: 'string', required: 0, readonly: 0, schema_metadata: {} },
        content: { field: 'content', type: 'text', required: 0, readonly: 0, schema_metadata: {} },
        metadata: { field: 'metadata', type: 'json', required: 0, readonly: 0, schema_metadata: {} },
      },
    },
  },
};

function createMockDatabase({
  permission = null,
  idRows = [],
  materializedRows = [],
  count = 1,
  singleRows = null,
} = {}) {
  const calls = [];
  return {
    calls,
    async query(sql, params = []) {
      const normalized = sql.replace(/\s+/g, ' ').trim();
      calls.push({ sql: normalized, params });

      if (normalized.includes('FROM yuncms_permissions') && normalized.includes('WHERE role = ?')) {
        return [permission ? [permission] : [], []];
      }
      if (normalized.includes('COUNT(*)')) {
        return [[{ total_count: count }], []];
      }
      if (normalized.startsWith('SELECT `id` FROM `articles`') && normalized.includes('ORDER BY')) {
        return [idRows, []];
      }
      if (normalized.startsWith('SELECT') && normalized.includes('IN (')) {
        return [materializedRows, []];
      }
      if (singleRows) {
        return [singleRows, []];
      }
      return [[{ id: 'art-1', title: 'Test', status: 'published' }], []];
    },
  };
}

test('projection with JSON/TEXT and explicit sort triggers identifier-only sorting followed by materialization', async () => {
  const database = createMockDatabase({
    idRows: [{ id: 'art-1' }, { id: 'art-2' }],
    materializedRows: [
      { id: 'art-1', title: 'First', content: 'Long text 1' },
      { id: 'art-2', title: 'Second', content: 'Long text 2' },
    ],
    count: 2,
  });

  const service = new ItemsService('articles', {
    database,
    schema,
    accountability: createSystemAccountability(),
  });

  const result = await service.readManyWithMeta({
    fields: ['id', 'title', 'content'],
    sort: ['title'],
    limit: 10,
    offset: 0,
  });

  assert.equal(database.calls.length, 3);
  // Phase 1: SELECT only PK with ORDER BY and LIMIT/OFFSET
  assert.match(database.calls[0].sql, /^SELECT `id` FROM `articles` ORDER BY `title` ASC LIMIT \? OFFSET \?$/);
  assert.deepEqual(database.calls[0].params, [10, 0]);

  // Phase 2: SELECT requested fields using PK placeholders, without ORDER BY or pagination
  assert.match(database.calls[1].sql, /^SELECT `id`, `title`, `content` FROM `articles` WHERE \(`id` IN \(\?, \?\)\)$/);
  assert.deepEqual(database.calls[1].params, ['art-1', 'art-2']);

  // Phase 3: COUNT query
  assert.match(database.calls[2].sql, /^SELECT COUNT\(\*\) AS total_count FROM `articles`$/);

  assert.equal(result.data.length, 2);
  assert.deepEqual(result.data.map((r) => r.id), ['art-1', 'art-2']);
  assert.equal(result.meta.total_count, 2);
});

test('final data order matches phase 1 order despite reversed or missing materialization rows', async () => {
  const database = createMockDatabase({
    idRows: [{ id: 'art-1' }, { id: 'art-2' }, { id: 'art-3' }],
    // Phase 2 returns rows in reversed order, and art-2 is missing (e.g. concurrently changed/deleted)
    materializedRows: [
      { id: 'art-3', title: 'Third', metadata: { k: 3 } },
      { id: 'art-1', title: 'First', metadata: { k: 1 } },
    ],
    count: 3,
  });

  const service = new ItemsService('articles', {
    database,
    schema,
    accountability: createSystemAccountability(),
  });

  const result = await service.readManyWithMeta({
    fields: ['id', 'title', 'metadata'],
    sort: ['-title'],
  });

  assert.equal(result.data.length, 2);
  // Preserves Phase 1 order (art-1 before art-3), and art-2 is not fabricated
  assert.deepEqual(result.data.map((r) => r.id), ['art-1', 'art-3']);
  assert.deepEqual(result.data[0].metadata, { k: 1 });
  assert.deepEqual(result.data[1].metadata, { k: 3 });
});

test('requested projection without PK does not leak internal PK into returned rows or read action', async () => {
  const sourceRows = [
    { id: 'art-1', title: 'First', content: 'Text 1' },
    { id: 'art-2', title: 'Second', content: 'Text 2' },
  ];
  const database = createMockDatabase({
    idRows: [{ id: 'art-1' }, { id: 'art-2' }],
    materializedRows: sourceRows,
    count: 2,
  });

  const emittedActions = [];
  const emitter = {
    async filter(event, payload) {
      return payload;
    },
    action(event, payload) {
      emittedActions.push({ event, payload });
    },
  };

  const service = new ItemsService('articles', {
    database,
    schema,
    emitter,
    accountability: createSystemAccountability(),
  });

  const result = await service.readManyWithMeta({
    fields: ['title', 'content'],
    sort: ['title'],
  });

  // Materialization query selected title, content, id internally
  assert.match(database.calls[1].sql, /^SELECT `title`, `content`, `id` FROM `articles` WHERE \(`id` IN \(\?, \?\)\)$/);

  // Result data rows must NOT have the id field
  for (const row of result.data) {
    assert.equal(Object.hasOwn(row, 'id'), false);
    assert.equal(row.id, undefined);
  }
  assert.deepEqual(result.data, [
    { title: 'First', content: 'Text 1' },
    { title: 'Second', content: 'Text 2' },
  ]);

  // Source row objects must NOT be mutated
  assert.equal(sourceRows[0].id, 'art-1');
  assert.equal(sourceRows[1].id, 'art-2');
  assert.equal(Object.hasOwn(sourceRows[0], 'id'), true);
  assert.equal(Object.hasOwn(sourceRows[1], 'id'), true);
  assert.notEqual(result.data[0], sourceRows[0]);
  assert.notEqual(result.data[1], sourceRows[1]);

  // items.read action keys must not leak stripped PKs
  assert.equal(emittedActions.length, 1);
  assert.equal(emittedActions[0].event, 'items.read');
  assert.deepEqual(emittedActions[0].payload.keys, []);
});

test('returned no-PK projection does not mutate source materialized row objects even when frozen', async () => {
  const sourceRows = Object.freeze([
    Object.freeze({ id: 'art-1', title: 'First', content: 'Text 1' }),
    Object.freeze({ id: 'art-2', title: 'Second', content: 'Text 2' }),
  ]);

  const database = createMockDatabase({
    idRows: [{ id: 'art-1' }, { id: 'art-2' }],
    materializedRows: sourceRows,
    count: 2,
  });

  const service = new ItemsService('articles', {
    database,
    schema,
    accountability: createSystemAccountability(),
  });

  const result = await service.readManyWithMeta({
    fields: ['title', 'content'],
    sort: ['title'],
  });

  assert.equal(result.data.length, 2);
  assert.equal(Object.hasOwn(result.data[0], 'id'), false);
  assert.equal(Object.hasOwn(result.data[1], 'id'), false);
  assert.equal(sourceRows[0].id, 'art-1');
  assert.equal(sourceRows[1].id, 'art-2');
});

test('count, offset, and caller filters are applied across phases', async () => {
  const database = createMockDatabase({
    idRows: [{ id: 'art-5' }],
    materializedRows: [{ id: 'art-5', title: 'Fifth', content: 'Sample' }],
    count: 42,
  });

  const service = new ItemsService('articles', {
    database,
    schema,
    accountability: createSystemAccountability(),
  });

  const result = await service.readManyWithMeta({
    fields: ['id', 'content'],
    filter: { status: { _eq: 'published' } },
    sort: ['title'],
    limit: 5,
    offset: 20,
  });

  assert.equal(result.meta.total_count, 42);
  assert.equal(result.meta.limit, 5);
  assert.equal(result.meta.offset, 20);

  // Phase 1 filter and limit/offset
  assert.match(database.calls[0].sql, /WHERE \(\(`status` = \?\)\) ORDER BY `title` ASC LIMIT \? OFFSET \?/);
  assert.deepEqual(database.calls[0].params, ['published', 5, 20]);

  // Phase 2 filter combines status filter and id IN clause
  assert.match(database.calls[1].sql, /WHERE \(\(\(`status` = \?\)\)\) AND \(`id` IN \(\?\)\)/);
  assert.deepEqual(database.calls[1].params, ['published', 'art-5']);

  // COUNT query uses caller filter
  assert.match(database.calls[2].sql, /SELECT COUNT\(\*\) AS total_count FROM `articles` WHERE \(\(`status` = \?\)\)/);
  assert.deepEqual(database.calls[2].params, ['published']);
});

test('denied sort field and denied projection field remain rejected before SQL runs', async () => {
  const database = createMockDatabase({
    permission: {
      id: 'perm-1',
      role: 'author-role',
      collection: 'articles',
      action: 'read',
      fields: JSON.stringify(['id', 'title', 'content']),
      filter: null,
      validation: null,
    },
  });

  const service = new ItemsService('articles', {
    database,
    schema,
    accountability: createAccountability({ user: 'user-1', role: 'author-role' }),
  });

  // Sort by unauthorized field (tenant_id is not in permitted fields)
  await assert.rejects(
    () => service.readManyWithMeta({ fields: ['id', 'content'], sort: ['tenant_id'] }),
    (err) => err.code === 'INVALID_QUERY',
  );
  assert.equal(database.calls.length, 1); // Only permission fetch was made

  // Select unauthorized field
  await assert.rejects(
    () => service.readManyWithMeta({ fields: ['id', 'tenant_id', 'content'], sort: ['title'] }),
    (err) => err.code === 'INVALID_QUERY',
  );
});

test('permission and hook filters are applied to both phases', async () => {
  const database = createMockDatabase({
    permission: {
      id: 'perm-1',
      role: 'tenant-role',
      collection: 'articles',
      action: 'read',
      fields: JSON.stringify(['id', 'title', 'content', 'tenant_id', 'status']),
      filter: JSON.stringify({ tenant_id: { _eq: 'tenant-abc' } }),
      validation: null,
    },
    idRows: [{ id: 'art-1' }],
    materializedRows: [{ id: 'art-1', title: 'Tenant Article', content: 'Text' }],
    count: 1,
  });

  const service = new ItemsService('articles', {
    database,
    schema,
    accountability: createAccountability({ user: 'user-1', role: 'tenant-role' }),
  });

  const result = await service.readManyWithMeta({
    fields: ['id', 'content'],
    filter: { status: { _eq: 'active' } },
    sort: ['title'],
  });

  assert.equal(result.data.length, 1);
  // Phase 1 has permission filter AND user filter
  assert.match(database.calls[1].sql, /WHERE \(\(`tenant_id` = \?\)\) AND \(\(`status` = \?\)\) ORDER BY `title`/);
  assert.deepEqual(database.calls[1].params.slice(0, 2), ['tenant-abc', 'active']);

  // Phase 2 has permission filter AND user filter AND id IN clause
  assert.match(database.calls[2].sql, /WHERE \(\(\(`tenant_id` = \?\)\) AND \(\(`status` = \?\)\)\) AND \(`id` IN \(\?\)\)/);
  assert.deepEqual(database.calls[2].params, ['tenant-abc', 'active', 'art-1']);
});

test('empty page avoids materialization query', async () => {
  const database = createMockDatabase({
    idRows: [], // 0 records match
    count: 0,
  });

  const service = new ItemsService('articles', {
    database,
    schema,
    accountability: createSystemAccountability(),
  });

  const result = await service.readManyWithMeta({
    fields: ['id', 'content'],
    sort: ['title'],
  });

  // Only Phase 1 query and COUNT query run, Phase 2 is skipped entirely
  assert.equal(database.calls.length, 2);
  assert.match(database.calls[0].sql, /^SELECT `id` FROM `articles` ORDER BY `title` ASC LIMIT \? OFFSET \?$/);
  assert.match(database.calls[1].sql, /^SELECT COUNT\(\*\) AS total_count FROM `articles`$/);

  assert.deepEqual(result.data, []);
  assert.equal(result.meta.total_count, 0);
});

test('aggregate query and small-only query remain on single-query path', async () => {
  const database = createMockDatabase({
    singleRows: [{ id: 'art-1', title: 'Short' }],
    count: 1,
  });

  const service = new ItemsService('articles', {
    database,
    schema,
    accountability: createSystemAccountability(),
  });

  // Small-only query (no json or text fields)
  const smallResult = await service.readManyWithMeta({
    fields: ['id', 'title'],
    sort: ['title'],
  });
  assert.equal(smallResult.data.length, 1);
  // Exactly 2 queries: single SELECT and COUNT
  assert.equal(database.calls.length, 2);
  assert.match(database.calls[0].sql, /^SELECT `id`, `title` FROM `articles` ORDER BY `title` ASC LIMIT \? OFFSET \?$/);
  assert.match(database.calls[1].sql, /^SELECT COUNT\(\*\) AS total_count FROM `articles`$/);

  // Large field query but WITHOUT sort stays on single-query path
  database.calls.length = 0;
  await service.readManyWithMeta({
    fields: ['id', 'content'],
  });
  assert.equal(database.calls.length, 2);
  assert.match(database.calls[0].sql, /^SELECT `id`, `content` FROM `articles` LIMIT \? OFFSET \?$/);

  // Aggregate query stays on aggregate single-query path
  database.calls.length = 0;
  await service.readManyWithMeta({
    aggregate: { count: ['id'] },
    groupBy: ['status'],
    sort: ['status'],
  });
  assert.equal(database.calls.length, 1);
  assert.match(database.calls[0].sql, /SELECT `status`, COUNT\(`id`\) AS `count_id` FROM `articles` GROUP BY `status` ORDER BY `status` ASC/);
});

test('bounded page IDs up to max limit 500 do not trigger maxInValues limit', async () => {
  const pageIds = Array.from({ length: 250 }, (_, i) => ({ id: `art-${i}` }));
  const matRows = pageIds.map((p) => ({ id: p.id, title: `Title ${p.id}`, content: `Body ${p.id}` }));
  const database = createMockDatabase({
    idRows: pageIds,
    materializedRows: matRows,
    count: 250,
  });

  const service = new ItemsService('articles', {
    database,
    schema,
    accountability: createSystemAccountability(),
  });

  const result = await service.readManyWithMeta({
    fields: ['id', 'content'],
    sort: ['title'],
    limit: 500,
  });

  assert.equal(result.data.length, 250);
  assert.equal(database.calls[1].params.length, 250);
});

test('HookEmitter applies caller + permission + hook filter constraints to both phases and fires query normalization and read action exactly once', async () => {
  const emitter = new HookEmitter();
  let queryHookCount = 0;
  let readActionCount = 0;
  let capturedActionPayload = null;

  emitter.registerFilter('items.query', async (query) => {
    queryHookCount++;
    return {
      ...query,
      filter: {
        _and: [
          query.filter,
          { status: { _eq: 'active' } },
        ],
      },
    };
  });

  emitter.registerAction('items.read', async (payload) => {
    readActionCount++;
    capturedActionPayload = payload;
  });

  const database = createMockDatabase({
    permission: {
      id: 'perm-1',
      role: 'tenant-role',
      collection: 'articles',
      action: 'read',
      fields: JSON.stringify(['id', 'title', 'content', 'tenant_id', 'status']),
      filter: JSON.stringify({ tenant_id: { _eq: 'tenant-abc' } }),
      validation: null,
    },
    idRows: [{ id: 'art-1' }],
    materializedRows: [{ id: 'art-1', title: 'Tenant Article', content: 'Long body' }],
    count: 1,
  });

  const service = new ItemsService('articles', {
    database,
    schema,
    emitter,
    accountability: createAccountability({ user: 'user-1', role: 'tenant-role' }),
  });

  const result = await service.readManyWithMeta({
    fields: ['id', 'content'],
    filter: { title: { _eq: 'Specific Title' } },
    sort: ['title'],
  });

  assert.equal(result.data.length, 1);
  assert.equal(queryHookCount, 1, 'items.query filter hook must be called exactly once');
  assert.equal(readActionCount, 1, 'items.read action hook must be called exactly once');
  assert.equal(capturedActionPayload?.keys?.[0], 'art-1');

  // Verify Phase 1 SQL contains permission filter, hook filter, and caller filter
  const phase1Sql = database.calls[1].sql;
  assert.match(phase1Sql, /SELECT `id` FROM `articles`/);
  assert.match(phase1Sql, /`tenant_id` = \?/);
  assert.match(phase1Sql, /`title` = \?/);
  assert.match(phase1Sql, /`status` = \?/);
  assert.match(phase1Sql, /ORDER BY `title` ASC/);

  // Verify Phase 2 SQL also reapplies permission filter, hook filter, and caller filter, plus IN clause
  const phase2Sql = database.calls[2].sql;
  assert.match(phase2Sql, /SELECT `id`, `content` FROM `articles`/);
  assert.match(phase2Sql, /`tenant_id` = \?/);
  assert.match(phase2Sql, /`title` = \?/);
  assert.match(phase2Sql, /`status` = \?/);
  assert.match(phase2Sql, /`id` IN \(\?\)/);

  // Verify Count SQL also reapplies permission filter, hook filter, and caller filter
  const countSql = database.calls[3].sql;
  assert.match(countSql, /SELECT COUNT\(\*\) AS total_count FROM `articles`/);
  assert.match(countSql, /`tenant_id` = \?/);
  assert.match(countSql, /`title` = \?/);
  assert.match(countSql, /`status` = \?/);
});
