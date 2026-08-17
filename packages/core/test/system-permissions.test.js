import assert from 'node:assert/strict';
import test from 'node:test';

import { createAccountability, createSystemAccountability } from '../src/accountability.js';
import { PermissionsService } from '../src/services/permissions-service.js';
import {
  assertActionOnlyPermissionPayload,
  assertSystemResourceAction,
  systemPermissionConfig,
} from '../src/system-permissions.js';

const schema = {
  version: 7,
  collections: {
    yuncms_users: {
      collection: 'yuncms_users',
      system: true,
      metadata: {
        permissionManaged: true,
        permissionMode: 'action-only',
        resource: 'users',
        allowedActions: ['read', 'create', 'update', 'delete'],
      },
      fields: {
        id: { field: 'id', type: 'uuid' },
        email: { field: 'email', type: 'string' },
      },
    },
    yuncms_roles: {
      collection: 'yuncms_roles',
      system: true,
      metadata: {
        permissionManaged: true,
        permissionMode: 'action-only',
        resource: 'roles',
        allowedActions: ['read'],
      },
      fields: {
        id: { field: 'id', type: 'uuid' },
        name: { field: 'name', type: 'string' },
      },
    },
    yuncms_permissions: {
      collection: 'yuncms_permissions',
      system: true,
      metadata: null,
      fields: { id: { field: 'id', type: 'uuid' } },
    },
  },
};

test('system permission policy is explicit and action-only', () => {
  const config = systemPermissionConfig(schema.collections.yuncms_users);
  assert.equal(config.resource, 'users');
  assert.equal(config.mode, 'action-only');
  assert.deepEqual(config.allowedActions, ['read', 'create', 'update', 'delete']);
  assert.doesNotThrow(() => assertSystemResourceAction(schema.collections.yuncms_users, 'update'));
  assert.throws(
    () => assertSystemResourceAction(schema.collections.yuncms_roles, 'create'),
    (error) => error.code === 'SYSTEM_PERMISSION_ACTION_PROTECTED',
  );
  assert.throws(
    () => assertActionOnlyPermissionPayload(schema.collections.yuncms_users, { fields: ['email'] }),
    (error) => error.code === 'SYSTEM_PERMISSION_ADVANCED_UNSUPPORTED',
  );
});

test('custom role can resolve an explicitly granted system users read permission', async () => {
  const database = {
    async query(sql, params = []) {
      const normalized = sql.replace(/\s+/g, ' ').trim();
      if (normalized.includes('FROM yuncms_permissions') && normalized.includes('WHERE role = ?')) {
        assert.deepEqual(params, ['role-1', 'yuncms_users', 'read']);
        return [[{
          id: 'permission-1',
          role: 'role-1',
          collection: 'yuncms_users',
          action: 'read',
          fields: null,
          filter: null,
          validation: null,
        }], []];
      }
      throw new Error(`Unexpected query: ${normalized}`);
    },
  };
  const service = new PermissionsService({
    database,
    schema,
    accountability: createAccountability({ user: 'user-1', role: 'role-1' }),
  });

  const permission = await service.resolve('read', 'yuncms_users');
  assert.equal(permission.fullAccess, false);
  assert.equal(permission.collection, 'yuncms_users');
});

test('unregistered system resources stay fail-closed', async () => {
  const service = new PermissionsService({
    database: { async query() { throw new Error('database should not be queried'); } },
    schema,
    accountability: createAccountability({ user: 'user-1', role: 'role-1' }),
  });

  await assert.rejects(
    service.resolve('read', 'yuncms_permissions'),
    (error) => error.code === 'FORBIDDEN',
  );
});

test('protected system actions and advanced system rules are rejected before mutation', async () => {
  const database = { async query() { throw new Error('database should not be queried'); } };
  const service = new PermissionsService({
    database,
    schema,
    accountability: createSystemAccountability(),
  });

  await assert.rejects(
    service.createOne({ role: 'role-1', collection: 'yuncms_roles', action: 'create' }),
    (error) => error.code === 'SYSTEM_PERMISSION_ACTION_PROTECTED',
  );
  await assert.rejects(
    service.createOne({
      role: 'role-1',
      collection: 'yuncms_users',
      action: 'read',
      fields: ['email'],
    }),
    (error) => error.code === 'SYSTEM_PERMISSION_ADVANCED_UNSUPPORTED',
  );
});

test('public role cannot be granted system resource access', async () => {
  let insertCalled = false;
  const database = {
    async query(sql) {
      const normalized = sql.replace(/\s+/g, ' ').trim();
      if (normalized.startsWith('SELECT id, admin, public FROM yuncms_roles')) {
        return [[{ id: 'public-role', admin: 0, public: 1 }], []];
      }
      if (normalized.startsWith('INSERT INTO yuncms_permissions')) insertCalled = true;
      return [[], []];
    },
  };
  const service = new PermissionsService({
    database,
    schema,
    accountability: createSystemAccountability(),
  });

  await assert.rejects(
    service.createOne({ role: 'public-role', collection: 'yuncms_users', action: 'read' }),
    (error) => error.code === 'PUBLIC_SYSTEM_ACCESS_FORBIDDEN',
  );
  assert.equal(insertCalled, false);
});
