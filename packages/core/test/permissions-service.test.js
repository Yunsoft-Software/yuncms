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

test('role permission resolves field and row restrictions', async () => {
  const database = databaseWithPermission({
    id: 'permission-1',
    role: 'role-1',
    collection: 'projects',
    action: 'read',
    fields: JSON.stringify(['id', 'title']),
    filter: JSON.stringify({ status: { _eq: 'active' } }),
    validation: null,
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
  assert.deepEqual(database.calls[0].params, ['role-1', 'projects', 'read']);
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

test('permission validation metadata cannot be stored before enforcement exists', async () => {
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
      validation: { title: { _nnull: true } },
    }),
    (error) => error.code === 'PERMISSION_VALIDATION_NOT_READY',
  );
  assert.equal(database.calls.length, 0);
});
