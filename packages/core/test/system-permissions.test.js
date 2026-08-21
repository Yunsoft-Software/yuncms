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
  version: 11,
  collections: {
    yuncms_users: {
      collection: 'yuncms_users',
      system: true,
      metadata: {
        permissionManaged: 1,
        permissionMode: 'action-only',
        resource: 'users',
        allowedActions: ['read', 'create', 'update', 'delete'],
      },
      fields: {
        id: { field: 'id', type: 'uuid' },
        email: { field: 'email', type: 'string' },
      },
    },
    yuncms_files: {
      collection: 'yuncms_files',
      system: true,
      metadata: {
        permissionManaged: true,
        permissionMode: 'action-only',
        resource: 'files',
        allowedActions: ['read', 'create', 'update', 'delete'],
      },
      fields: {
        id: { field: 'id', type: 'uuid' },
        title: { field: 'title', type: 'string' },
      },
    },
    yuncms_roles: {
      collection: 'yuncms_roles',
      system: true,
      metadata: {
        permissionManaged: true,
        permissionMode: 'action-only',
        resource: 'roles',
        allowedActions: ['read', 'create', 'update', 'delete'],
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
  assert.doesNotThrow(() => assertSystemResourceAction(schema.collections.yuncms_roles, 'create'));
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

test('advanced system rules are rejected before mutation', async () => {
  const database = { async query() { throw new Error('database should not be queried'); } };
  const service = new PermissionsService({
    database,
    schema,
    accountability: createSystemAccountability(),
  });

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

function publicGrantDatabase() {
  let inserted = null;
  return {
    async query(sql, params = []) {
      const normalized = sql.replace(/\s+/g, ' ').trim();
      if (normalized.startsWith('SELECT id, admin, public FROM yuncms_roles')) {
        return [[{ id: 'public-role', admin: 0, public: 1 }], []];
      }
      if (normalized.startsWith('INSERT INTO yuncms_permissions')) {
        inserted = {
          id: params[0],
          role: params[1],
          collection: params[2],
          action: params[3],
          fields: params[4],
          filter: params[5],
          validation: params[6],
        };
        return [{ affectedRows: 1 }, []];
      }
      if (normalized.includes('FROM yuncms_permissions WHERE id = ?')) {
        return [[{
          ...inserted,
          created_at: null,
          updated_at: null,
        }], []];
      }
      throw new Error(`Unexpected query: ${normalized}`);
    },
  };
}

test('public role can receive an explicit permission-managed Files read grant', async () => {
  const service = new PermissionsService({
    database: publicGrantDatabase(),
    schema,
    accountability: createSystemAccountability(),
  });

  const permission = await service.createOne({
    role: 'public-role',
    collection: 'yuncms_files',
    action: 'read',
  });

  assert.equal(permission.role, 'public-role');
  assert.equal(permission.collection, 'yuncms_files');
  assert.equal(permission.action, 'read');
  assert.equal(permission.fields, null);
});

test('public role can receive an explicit permission-managed Roles create grant', async () => {
  const service = new PermissionsService({
    database: publicGrantDatabase(),
    schema,
    accountability: createSystemAccountability(),
  });

  const permission = await service.createOne({
    role: 'public-role',
    collection: 'yuncms_roles',
    action: 'create',
  });

  assert.equal(permission.role, 'public-role');
  assert.equal(permission.collection, 'yuncms_roles');
  assert.equal(permission.action, 'create');
});
