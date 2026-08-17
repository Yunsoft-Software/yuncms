import assert from 'node:assert/strict';
import test from 'node:test';

import { createAccountability } from '../src/accountability.js';
import { UsersService } from '../src/services/users-service.js';

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
  },
};

function delegatedAccountability() {
  return createAccountability({ user: 'manager-1', role: 'manager-role' });
}

function permissionRow(action) {
  return {
    id: `permission-${action}`,
    role: 'manager-role',
    collection: 'yuncms_users',
    action,
    fields: null,
    filter: null,
    validation: null,
  };
}

test('delegated manager can read users only with explicit system users permission', async () => {
  const database = {
    async query(sql, params = []) {
      const normalized = sql.replace(/\s+/g, ' ').trim();
      if (normalized.includes('FROM yuncms_permissions') && normalized.includes('WHERE role = ?')) {
        assert.deepEqual(params, ['manager-role', 'yuncms_users', 'read']);
        return [[permissionRow('read')], []];
      }
      if (normalized.startsWith('SELECT id, email, role, status')) {
        return [[{ id: 'user-1', email: 'user@example.com', role: null, status: 'active' }], []];
      }
      throw new Error(`Unexpected query: ${normalized}`);
    },
  };
  const service = new UsersService({ database, schema, accountability: delegatedAccountability() });
  const rows = await service.readMany();
  assert.equal(rows.length, 1);
  assert.equal(rows[0].email, 'user@example.com');
});

test('delegated manager cannot assign administrator role', async () => {
  let updateCalled = false;
  const database = {
    async query(sql, params = []) {
      const normalized = sql.replace(/\s+/g, ' ').trim();
      if (normalized.includes('FROM yuncms_permissions') && normalized.includes('WHERE role = ?')) {
        return [[permissionRow('update')], []];
      }
      if (normalized.startsWith('SELECT u.id, r.admin AS role_admin')) {
        return [[{ id: params[0], role_admin: 0 }], []];
      }
      if (normalized.startsWith('SELECT id, admin, public FROM yuncms_roles')) {
        return [[{ id: params[0], admin: 1, public: 0 }], []];
      }
      if (normalized.startsWith('UPDATE yuncms_users')) updateCalled = true;
      return [[], []];
    },
  };
  const service = new UsersService({ database, schema, accountability: delegatedAccountability() });

  await assert.rejects(
    service.updateOne('user-2', { role: 'admin-role' }),
    (error) => error.code === 'FORBIDDEN',
  );
  assert.equal(updateCalled, false);
});

test('delegated manager cannot modify an existing administrator account', async () => {
  let updateCalled = false;
  const database = {
    async query(sql, params = []) {
      const normalized = sql.replace(/\s+/g, ' ').trim();
      if (normalized.includes('FROM yuncms_permissions') && normalized.includes('WHERE role = ?')) {
        return [[permissionRow('update')], []];
      }
      if (normalized.startsWith('SELECT u.id, r.admin AS role_admin')) {
        return [[{ id: params[0], role_admin: 1 }], []];
      }
      if (normalized.startsWith('UPDATE yuncms_users')) updateCalled = true;
      return [[], []];
    },
  };
  const service = new UsersService({ database, schema, accountability: delegatedAccountability() });

  await assert.rejects(
    service.updateOne('admin-user', { status: 'suspended' }),
    (error) => error.code === 'FORBIDDEN',
  );
  assert.equal(updateCalled, false);
});
