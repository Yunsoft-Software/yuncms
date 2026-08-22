import assert from 'node:assert/strict';
import test from 'node:test';

import { createSystemAccountability } from '../src/accountability.js';
import { PermissionsService } from '../src/services/permissions-service.js';
import { RolesService } from '../src/services/roles-service.js';
import { UsersService } from '../src/services/users-service.js';

function recordingEmitter() {
  const events = [];
  return {
    events,
    async action(event, payload, context) {
      events.push({ event, payload, context });
    },
  };
}

test('password changes emit an audit-safe event without password material', async () => {
  const emitter = recordingEmitter();
  const connection = {
    async beginTransaction() {},
    async commit() {},
    async rollback() {},
    release() {},
    async query(sql) {
      const normalized = sql.replace(/\s+/g, ' ').trim();
      if (normalized.startsWith('UPDATE yuncms_users SET password_hash')) return [{ affectedRows: 1 }, []];
      if (normalized.startsWith('DELETE FROM yuncms_sessions')) return [{ affectedRows: 2 }, []];
      throw new Error(`Unexpected query: ${normalized}`);
    },
  };
  const service = new UsersService({
    accountability: createSystemAccountability(),
    database: { async getConnection() { return connection; } },
    emitter,
    requestId: 'req-password',
  });

  await service.updatePassword('user-1', 'new-password-123');

  assert.equal(emitter.events.length, 1);
  assert.equal(emitter.events[0].event, 'users.password.update');
  assert.deepEqual(emitter.events[0].payload, { key: 'user-1' });
  assert.equal(JSON.stringify(emitter.events[0]).includes('new-password-123'), false);
  assert.equal(emitter.events[0].context.collection, 'yuncms_users');
});

test('role creation emits a security audit action', async () => {
  const emitter = recordingEmitter();
  let createdId = null;
  const database = {
    async query(sql, params = []) {
      const normalized = sql.replace(/\s+/g, ' ').trim();
      if (normalized.startsWith('INSERT INTO yuncms_roles')) {
        createdId = params[0];
        return [{ affectedRows: 1 }, []];
      }
      if (normalized.includes('FROM yuncms_roles') && normalized.includes('WHERE id = ?')) {
        return [[{
          id: createdId,
          name: 'Editor',
          description: null,
          admin: 0,
          public: 0,
        }], []];
      }
      throw new Error(`Unexpected query: ${normalized}`);
    },
  };
  const service = new RolesService({
    accountability: createSystemAccountability(),
    database,
    emitter,
    requestId: 'req-role',
  });

  await service.createOne({ name: 'Editor' });
  assert.equal(emitter.events[0].event, 'roles.create');
  assert.equal(emitter.events[0].payload.item.name, 'Editor');
  assert.equal(emitter.events[0].context.collection, 'yuncms_roles');
});

test('permission deletion emits the prior rule for security audit history', async () => {
  const emitter = recordingEmitter();
  const database = {
    async query(sql, params = []) {
      const normalized = sql.replace(/\s+/g, ' ').trim();
      if (normalized.includes('FROM yuncms_permissions WHERE id = ?')) {
        return [[{
          id: params[0],
          role: 'role-1',
          collection: 'projects',
          action: 'read',
          fields: null,
          filter: null,
          validation: null,
        }], []];
      }
      if (normalized.startsWith('DELETE FROM yuncms_permissions')) return [{ affectedRows: 1 }, []];
      throw new Error(`Unexpected query: ${normalized}`);
    },
  };
  const service = new PermissionsService({
    accountability: createSystemAccountability(),
    database,
    emitter,
    requestId: 'req-permission',
  });

  await service.deleteOne('permission-1');
  assert.equal(emitter.events[0].event, 'permissions.delete');
  assert.equal(emitter.events[0].payload.before.role, 'role-1');
  assert.equal(emitter.events[0].context.collection, 'yuncms_permissions');
});
