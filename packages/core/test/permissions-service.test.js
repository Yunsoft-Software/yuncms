import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createAccountability,
  createPublicAccountability,
  createSystemAccountability,
} from '../src/accountability.js';
import { PermissionsService } from '../src/services/permissions-service.js';

const schema = {
  version: 1,
  collections: {
    projects: {
      collection: 'projects',
      primary_key: 'id',
      fields: {
        id: { field: 'id', type: 'uuid' },
        title: { field: 'title', type: 'string' },
        status: { field: 'status', type: 'string' },
      },
    },
  },
};

function databaseWithPermission(permission = null) {
  const calls = [];
  return {
    calls,
    async query(sql, params = []) {
      const normalized = sql.replace(/\s+/g, ' ').trim();
      calls.push({ sql: normalized, params });
      if (normalized.includes('FROM yuncms_permissions') && normalized.includes('WHERE role = ?')) {
        return [permission ? [permission] : [], []];
      }
      return [[], []];
    },
  };
}

test('system accountability resolves full access without permission lookup', async () => {
  const database = databaseWithPermission();
  const service = new PermissionsService({
    database,
    schema,
    accountability: createSystemAccountability(),
  });

  const permission = await service.resolve('read', 'projects');
  assert.equal(permission.fullAccess, true);
  assert.equal(database.calls.length, 0);
});

test('role-less public accountability is denied before querying permission rows', async () => {
  const database = databaseWithPermission();
  const service = new PermissionsService({
    database,
    schema,
    accountability: createPublicAccountability(),
  });

  await assert.rejects(
    service.resolve('read', 'projects'),
    (error) => error.code === 'FORBIDDEN',
  );
  assert.equal(database.calls.length, 0);
});

test('role permission resolves field, row and validation restrictions', async () => {
  const database = databaseWithPermission({
    id: 'permission-1',
    role: 'role-1',
    collection: 'projects',
    action: 'read',
    fields: JSON.stringify(['id', 'title']),
    filter: JSON.stringify({ status: { _eq: 'active' } }),
    validation: JSON.stringify({ title: { _nnull: true } }),
  });
  const service = new PermissionsService({
    database,
    schema,
    accountability: createAccountability({ user: 'user-1', role: 'role-1' }),
  });

  const permission = await service.resolve('read', 'projects');
  assert.equal(permission.fullAccess, false);
  assert.deepEqual(permission.fields, ['id', 'title']);
  assert.deepEqual(permission.filter, { status: { _eq: 'active' } });
  assert.deepEqual(permission.validation, { title: { _nnull: true } });
  assert.deepEqual(database.calls[0].params, ['role-1', 'projects', 'read']);
});

test('request-local permission cache avoids duplicate lookups', async () => {
  const database = databaseWithPermission({
    id: 'permission-1',
    role: 'role-1',
    collection: 'projects',
    action: 'read',
    fields: null,
    filter: null,
    validation: null,
  });
  const permissionCache = new Map();
  const service = new PermissionsService({
    database,
    schema,
    permissionCache,
    accountability: createAccountability({ user: 'user-1', role: 'role-1' }),
  });

  const first = await service.resolve('read', 'projects');
  const second = await service.resolve('read', 'projects');

  assert.equal(first, second);
  assert.equal(database.calls.length, 1);
});

test('missing role permission fails closed', async () => {
  const database = databaseWithPermission();
  const service = new PermissionsService({
    database,
    schema,
    accountability: createAccountability({ user: 'user-1', role: 'role-1' }),
  });

  await assert.rejects(
    service.resolve('delete', 'projects'),
    (error) => error.code === 'FORBIDDEN',
  );
});

test('permission validation metadata is schema-validated before database mutation', async () => {
  const database = databaseWithPermission();
  const service = new PermissionsService({
    database,
    schema,
    accountability: createSystemAccountability(),
  });

  await assert.rejects(
    service.createOne({
      role: 'role-1',
      collection: 'projects',
      action: 'create',
      fields: ['title'],
      validation: { unknown_field: { _eq: 'blocked' } },
    }),
    (error) => error.code === 'INVALID_QUERY',
  );
  assert.equal(database.calls.length, 0);
});

test('permission metadata accepts supported dynamic values but rejects unsupported nested paths', async () => {
  const database = databaseWithPermission();
  const service = new PermissionsService({
    database,
    schema,
    accountability: createSystemAccountability(),
  });

  await assert.rejects(
    service.createOne({
      role: 'role-1',
      collection: 'projects',
      action: 'read',
      filter: {
        _and: [
          { id: { _eq: '$CURRENT_USER' } },
          { status: { _eq: '$CURRENT_ROLE' } },
        ],
      },
    }),
    (error) => error.code === 'ROLE_NOT_FOUND',
  );
  assert.equal(database.calls.length, 1, 'supported variables should reach the role lookup');

  database.calls.length = 0;
  await assert.rejects(
    service.createOne({
      role: 'role-1',
      collection: 'projects',
      action: 'read',
      filter: { id: { _eq: '$CURRENT_USER.email' } },
    }),
    (error) => error.code === 'INVALID_QUERY',
  );
  assert.equal(database.calls.length, 0);
});

test('permission filter accepts M2O relational predicates while prospective write validation keeps scalar-only rules', async () => {
  const relationalSchema = {
    version: 1,
    collections: {
      articles: {
        collection: 'articles',
        primary_key: 'id',
        fields: {
          id: { field: 'id', type: 'uuid' },
          status: { field: 'status', type: 'string' },
        },
      },
      articles_translations: {
        collection: 'articles_translations',
        primary_key: 'id',
        fields: {
          id: { field: 'id', type: 'uuid' },
          articles_id: { field: 'articles_id', type: 'uuid' },
          title: { field: 'title', type: 'string' },
        },
      },
    },
    relations: [
      {
        many_collection: 'articles_translations',
        many_field: 'articles_id',
        one_collection: 'articles',
        one_field: 'id',
      },
    ],
  };

  const database = databaseWithPermission();
  const service = new PermissionsService({
    database,
    schema: relationalSchema,
    accountability: createSystemAccountability(),
  });

  await assert.rejects(
    service.createOne({
      role: 'role-1',
      collection: 'articles_translations',
      action: 'read',
      filter: { articles_id: { status: { _eq: 'published' } } },
    }),
    (error) => error.code === 'ROLE_NOT_FOUND',
  );
  assert.equal(database.calls.length, 1, 'valid relational row filter should pass schema compilation and reach role lookup');

  database.calls.length = 0;
  await assert.rejects(
    service.createOne({
      role: 'role-1',
      collection: 'articles_translations',
      action: 'create',
      validation: { articles_id: { status: { _eq: 'published' } } },
    }),
    (error) => error.code === 'INVALID_QUERY' && error.path === 'filter.articles_id.status',
  );
  assert.equal(database.calls.length, 0, 'prospective write validation must reject unhydrated relational traversal');
});
