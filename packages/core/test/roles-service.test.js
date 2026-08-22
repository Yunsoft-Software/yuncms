import test from 'node:test';
import assert from 'node:assert/strict';

import { createAccountability, createSystemAccountability } from '../src/accountability.js';
import { RolesService } from '../src/services/roles-service.js';

const schema = {
  collections: {
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
        description: { field: 'description', type: 'text' },
        admin: { field: 'admin', type: 'boolean' },
        public: { field: 'public', type: 'boolean' },
      },
    },
  },
};

function createDatabase({ grants = [], publicRole = null, existingRoles = [] } = {}) {
  const calls = [];
  const roles = new Map(existingRoles.map((role) => [role.id, { ...role }]));

  return {
    calls,
    roles,
    async query(sql, params = []) {
      const normalized = sql.replace(/\s+/g, ' ').trim();
      calls.push({ sql: normalized, params });

      if (normalized.includes('FROM yuncms_permissions') && normalized.includes('WHERE role = ?')) {
        const [role, collection, action] = params;
        if (collection === 'yuncms_roles' && grants.includes(action)) {
          return [[{
            id: `permission-${action}`,
            role,
            collection,
            action,
            fields: null,
            filter: null,
            validation: null,
          }], []];
        }
        return [[], []];
      }
      if (normalized === 'SELECT id FROM yuncms_roles WHERE public = 1 LIMIT 1') {
        return [publicRole ? [{ id: publicRole }] : [], []];
      }
      if (normalized.startsWith('INSERT INTO yuncms_roles')) {
        roles.set(params[0], {
          id: params[0],
          name: params[1],
          description: params[2],
          admin: params[3],
          public: params[4],
          created_at: null,
          updated_at: null,
        });
        return [{ affectedRows: 1 }, []];
      }
      if (normalized.startsWith('SELECT')
        && normalized.includes('FROM yuncms_roles')
        && normalized.includes('WHERE id = ?')) {
        const role = roles.get(params[0]);
        return [role ? [{ ...role }] : [], []];
      }
      if (normalized.startsWith('UPDATE yuncms_roles SET name = ? WHERE id = ?')) {
        const role = roles.get(params[1]);
        if (!role) return [{ affectedRows: 0 }, []];
        role.name = params[0];
        return [{ affectedRows: 1 }, []];
      }
      if (normalized === 'SELECT id FROM yuncms_users WHERE role = ? LIMIT 1') return [[], []];
      if (normalized === 'DELETE FROM yuncms_roles WHERE id = ?') {
        return [{ affectedRows: roles.delete(params[0]) ? 1 : 0 }, []];
      }
      return [[], []];
    },
  };
}

function delegatedService(database) {
  return new RolesService({
    database,
    schema,
    accountability: createAccountability({ user: 'user-1', role: 'role-1' }),
  });
}

test('role actions stay denied for delegated roles until explicitly granted', async () => {
  const database = createDatabase();
  const service = delegatedService(database);

  await assert.rejects(
    service.createOne({ name: 'Role' }),
    (error) => error.code === 'FORBIDDEN',
  );
  assert.equal(database.calls.some(({ sql }) => sql.startsWith('INSERT INTO yuncms_roles')), false);
});

test('explicit role grants enable create, update and delete without requiring read', async () => {
  const database = createDatabase({
    grants: ['create', 'update', 'delete'],
    existingRoles: [{
      id: 'role-existing',
      name: 'Existing',
      description: null,
      admin: 0,
      public: 0,
      created_at: null,
      updated_at: null,
    }],
  });
  const service = delegatedService(database);

  const created = await service.createOne({ name: 'Editors' });
  assert.equal(created.name, 'Editors');

  const updated = await service.updateOne('role-existing', { name: 'Renamed' });
  assert.equal(updated.name, 'Renamed');

  assert.equal(await service.deleteOne('role-existing'), true);
  assert.equal(database.roles.has('role-existing'), false);
});

test('delegated role creation cannot mint administrator or public roles as a side effect', async () => {
  const database = createDatabase({ grants: ['create'] });
  const service = delegatedService(database);

  await assert.rejects(
    service.createOne({ name: 'Unsafe', admin: true }),
    (error) => error.code === 'FORBIDDEN',
  );
  await assert.rejects(
    service.createOne({ name: 'Unsafe Public', public: true }),
    (error) => error.code === 'FORBIDDEN',
  );
  assert.equal(database.calls.some(({ sql }) => sql.startsWith('INSERT INTO yuncms_roles')), false);
});

test('a role cannot be both public and administrator', async () => {
  const database = createDatabase();
  const service = new RolesService({
    database,
    schema,
    accountability: createSystemAccountability(),
  });

  await assert.rejects(
    service.createOne({ name: 'Unsafe', admin: true, public: true }),
    (error) => error.code === 'INVALID_ROLE',
  );
  assert.equal(database.calls.length, 0);
});

test('a second public role is rejected before insert', async () => {
  const database = createDatabase({ publicRole: 'public-role-1' });
  const service = new RolesService({
    database,
    schema,
    accountability: createSystemAccountability(),
  });

  await assert.rejects(
    service.createOne({ name: 'Public 2', public: true }),
    (error) => error.code === 'PUBLIC_ROLE_EXISTS',
  );
  assert.equal(database.calls.some(({ sql }) => sql.startsWith('INSERT INTO yuncms_roles')), false);
});
