import assert from 'node:assert/strict';
import test from 'node:test';

import { createAccountability } from '../src/accountability.js';
import { MemoryCacheStore } from '../src/cache.js';
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
      },
    },
  },
};

function accountability() {
  return createAccountability({ user: 'user-1', role: 'role-1' });
}

test('shared permission cache avoids duplicate database lookups across service instances', async () => {
  let permissionQueries = 0;
  const database = {
    async query(sql) {
      const normalized = sql.replace(/\s+/g, ' ').trim();
      if (normalized.includes('FROM yuncms_permissions') && normalized.includes('WHERE role = ?')) {
        permissionQueries += 1;
        return [[{
          id: 'permission-1',
          role: 'role-1',
          collection: 'projects',
          action: 'read',
          fields: null,
          filter: null,
          validation: null,
        }], []];
      }
      throw new Error(`Unexpected query: ${normalized}`);
    },
  };
  const permissionCache = new MemoryCacheStore({ ttlMs: 60_000, maxEntries: 100 });

  const firstService = new PermissionsService({
    database,
    schema,
    permissionCache,
    accountability: accountability(),
  });
  const secondService = new PermissionsService({
    database,
    schema,
    permissionCache,
    accountability: accountability(),
  });

  const first = await firstService.resolve('read', 'projects');
  const second = await secondService.resolve('read', 'projects');

  assert.deepEqual(second, first);
  assert.equal(permissionQueries, 1);
});

test('permission mutations clear a shared cache before future authorization decisions', async () => {
  let cleared = false;
  const permissionCache = {
    async get() { return undefined; },
    async set() {},
    async delete() {},
    async clear() { cleared = true; },
  };
  const database = {
    async query(sql, params = []) {
      const normalized = sql.replace(/\s+/g, ' ').trim();
      if (normalized.startsWith('DELETE FROM yuncms_permissions')) {
        assert.deepEqual(params, ['permission-1']);
        return [{ affectedRows: 1 }, []];
      }
      throw new Error(`Unexpected query: ${normalized}`);
    },
  };
  const service = new PermissionsService({
    database,
    schema,
    permissionCache,
    accountability: { user: 'system', role: null, admin: false, system: true },
  });

  await service.deleteOne('permission-1');
  assert.equal(cleared, true);
});
