import assert from 'node:assert/strict';
import test from 'node:test';

import { createAccountability, createSystemAccountability } from '../src/accountability.js';
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

test('management-created users are immediately email verified', async () => {
  let inserted = null;
  const database = {
    async query(sql, params = []) {
      const normalized = sql.replace(/\s+/g, ' ').trim();
      if (normalized.startsWith('INSERT INTO yuncms_users')) {
        inserted = params;
        return [{ affectedRows: 1 }, []];
      }
      if (normalized.startsWith('SELECT id, email, role, status')) {
        return [[{
          id: inserted?.[0],
          email: inserted?.[1],
          role: inserted?.[3] ?? null,
          status: inserted?.[4],
          email_verified_at: inserted?.[5] ?? null,
        }], []];
      }
      throw new Error(`Unexpected query: ${normalized}`);
    },
  };
  const service = new UsersService({
    database,
    schema,
    accountability: createSystemAccountability(),
  });

  const user = await service.createOne({
    email: 'Managed@Example.com',
    password: 'long-enough-password',
    status: 'active',
    emailVerified: false,
  });

  assert.ok(inserted);
  assert.equal(inserted[1], 'managed@example.com');
  assert.ok(inserted[5] instanceof Date);
  assert.ok(user.email_verified_at instanceof Date);
});

test('self password change remains available and revokes existing sessions', async () => {
  const calls = [];
  const connection = {
    async beginTransaction() { calls.push('begin'); },
    async commit() { calls.push('commit'); },
    async rollback() { calls.push('rollback'); },
    release() { calls.push('release'); },
    async query(sql, params = []) {
      const normalized = sql.replace(/\s+/g, ' ').trim();
      if (normalized.startsWith('UPDATE yuncms_users SET password_hash')) {
        calls.push({ type: 'password', user: params[1], hash: params[0] });
        return [{ affectedRows: 1 }, []];
      }
      if (normalized.startsWith('DELETE FROM yuncms_sessions')) {
        calls.push({ type: 'sessions', user: params[0] });
        return [{ affectedRows: 2 }, []];
      }
      throw new Error(`Unexpected query: ${normalized}`);
    },
  };
  const database = { async getConnection() { return connection; } };
  const service = new UsersService({
    database,
    schema,
    accountability: createAccountability({ user: 'user-self', role: 'role-1' }),
  });

  await service.updatePassword('user-self', 'new-password-123');
  const passwordCall = calls.find((entry) => entry?.type === 'password');
  const sessionsCall = calls.find((entry) => entry?.type === 'sessions');
  assert.equal(passwordCall.user, 'user-self');
  assert.match(passwordCall.hash, /^scrypt\$/);
  assert.equal(sessionsCall.user, 'user-self');
  assert.equal(calls.includes('commit'), true);
  assert.equal(calls.includes('release'), true);
});

test('delegated user manager cannot change another user password', async () => {
  const database = {
    async getConnection() {
      throw new Error('connection should not be requested');
    },
  };
  const service = new UsersService({ database, schema, accountability: delegatedAccountability() });

  await assert.rejects(
    service.updatePassword('user-2', 'new-password-123'),
    (error) => error.code === 'FORBIDDEN',
  );
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
