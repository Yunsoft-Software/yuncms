import assert from 'node:assert/strict';
import test from 'node:test';

import { createAccountability } from '../src/accountability.js';
import { RolesService } from '../src/services/roles-service.js';

const schema = {
  version: 7,
  collections: {
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
  },
};

test('custom role can read role labels when yuncms_roles read is granted', async () => {
  const database = {
    async query(sql, params = []) {
      const normalized = sql.replace(/\s+/g, ' ').trim();
      if (normalized.includes('FROM yuncms_permissions') && normalized.includes('WHERE role = ?')) {
        assert.deepEqual(params, ['manager-role', 'yuncms_roles', 'read']);
        return [[{
          id: 'permission-read',
          role: 'manager-role',
          collection: 'yuncms_roles',
          action: 'read',
          fields: null,
          filter: null,
          validation: null,
        }], []];
      }
      if (normalized.startsWith('SELECT id, name, description, admin, public')) {
        return [[{ id: 'role-1', name: 'Editor', description: null, admin: 0, public: 0 }], []];
      }
      throw new Error(`Unexpected query: ${normalized}`);
    },
  };
  const service = new RolesService({
    database,
    schema,
    accountability: createAccountability({ user: 'user-1', role: 'manager-role' }),
  });

  const roles = await service.readMany();
  assert.equal(roles[0].name, 'Editor');
});
