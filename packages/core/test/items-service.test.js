import test from 'node:test';
import assert from 'node:assert/strict';

import { createPublicAccountability, createSystemAccountability } from '../src/accountability.js';
import { ItemsService } from '../src/services/items-service.js';

const schema = {
  version: 1,
  collections: {
    projects: {
      collection: 'projects',
      primary_key: 'id',
      fields: {
        id: { field: 'id', type: 'uuid', required: 1, readonly: 1, schema_metadata: { primaryKey: true } },
        title: { field: 'title', type: 'string', required: 1, readonly: 0, schema_metadata: {} },
        status: { field: 'status', type: 'string', required: 0, readonly: 0, schema_metadata: {} },
      },
    },
  },
};

function createDatabase() {
  const calls = [];
  return {
    calls,
    async query(sql, params = []) {
      calls.push({ sql: sql.replace(/\s+/g, ' ').trim(), params });
      if (sql.includes('COUNT(*)')) return [[{ total_count: 1 }], []];
      if (sql.startsWith('SELECT')) return [[{ id: 'project-1', title: 'Demo', status: 'active' }], []];
      return [{ affectedRows: 1 }, []];
    },
  };
}

test('items service stays closed to public accountability until RBAC exists', async () => {
  const database = createDatabase();
  const service = new ItemsService('projects', {
    database,
    schema,
    accountability: createPublicAccountability(),
  });

  await assert.rejects(
    service.readMany(),
    (error) => error.code === 'PERMISSIONS_NOT_READY',
  );
  assert.equal(database.calls.length, 0);
});

test('admin/system read query parameterizes values and applies limit/offset', async () => {
  const database = createDatabase();
  const service = new ItemsService('projects', {
    database,
    schema,
    accountability: createSystemAccountability(),
  });

  const result = await service.readManyWithMeta({
    fields: ['id', 'title'],
    filter: { status: { _eq: 'active' } },
    sort: ['-title'],
    limit: 10,
    offset: 5,
  });

  assert.equal(result.meta.total_count, 1);
  assert.match(database.calls[0].sql, /WHERE \(`status` = \?\) ORDER BY `title` DESC LIMIT \? OFFSET \?/);
  assert.deepEqual(database.calls[0].params, ['active', 10, 5]);
  assert.equal(database.calls[0].sql.includes('active'), false);
});

test('bulk update/delete require explicit non-empty filters', async () => {
  const database = createDatabase();
  const service = new ItemsService('projects', {
    database,
    schema,
    accountability: createSystemAccountability(),
  });

  await assert.rejects(service.updateMany({}, { status: 'done' }), (error) => error.code === 'FILTER_REQUIRED');
  await assert.rejects(service.deleteMany(null), (error) => error.code === 'FILTER_REQUIRED');

  const affected = await service.updateMany({ status: { _eq: 'active' } }, { status: 'done' });
  assert.equal(affected, 1);
  assert.match(database.calls.at(-1).sql, /UPDATE `projects` SET `status` = \? WHERE \(`status` = \?\)/);
  assert.deepEqual(database.calls.at(-1).params, ['done', 'active']);
});
