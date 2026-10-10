import assert from 'node:assert/strict';
import test from 'node:test';

import { createCoreServiceRegistry } from '../src/services/core-services.js';
import {
  assertSingletonVacant,
  SingletonCollectionsService,
  SingletonItemsService,
  singletonLockName,
} from '../src/services/singleton-services.js';

test('core runtime registry uses singleton-safe collection and item services', () => {
  const services = createCoreServiceRegistry().toObject();
  assert.equal(services.ItemsService, SingletonItemsService);
  assert.equal(services.CollectionsService, SingletonCollectionsService);
});

test('singleton advisory lock names stay bounded for long collection keys', () => {
  const lock = singletonLockName(`collection_${'x'.repeat(54)}`);
  assert.ok(lock.length <= 64);
  assert.match(lock, /^yuncms:singleton:[a-f0-9]{40}$/);
});

test('singleton vacancy check rejects a second physical item', async () => {
  const database = {
    async query(sql) {
      assert.match(sql, /SELECT 1 AS present/);
      return [[{ present: 1 }]];
    },
  };
  await assert.rejects(
    () => assertSingletonVacant(database, 'site_settings', { singleton: true }),
    (error) => error.code === 'SINGLETON_ITEM_EXISTS',
  );
});

test('non-singleton collections skip the singleton cardinality query', async () => {
  const database = { query: async () => assert.fail('query should not run') };
  await assertSingletonVacant(database, 'articles', { singleton: false });
});

const singletonSchema = {
  version: 1,
  collections: {
    site_settings: {
      collection: 'site_settings',
      singleton: true,
      primary_key: 'id',
      fields: {
        id: { field: 'id', type: 'uuid', required: 1, readonly: 1, schema_metadata: { primaryKey: true } },
        title: { field: 'title', type: 'string', required: 1, readonly: 0, schema_metadata: {} },
      },
    },
    posts: {
      collection: 'posts',
      singleton: false,
      primary_key: 'id',
      fields: {
        id: { field: 'id', type: 'uuid', required: 1, readonly: 1, schema_metadata: { primaryKey: true } },
        title: { field: 'title', type: 'string', required: 1, readonly: 0, schema_metadata: {} },
      },
    },
    yuncms_collections: {
      collection: 'yuncms_collections',
      system: true,
      singleton: false,
      primary_key: 'collection',
      fields: {
        collection: { field: 'collection', type: 'string', required: 1, readonly: 1, schema_metadata: { primaryKey: true } },
      },
    },
  },
};

function createMockPool({ occupied = false, permission = null } = {}) {
  const calls = [];
  const connection = {
    release() { calls.push('release'); },
    async query(sql, params = []) {
      const normalized = sql.replace(/\s+/g, ' ').trim();
      calls.push({ sql: normalized, params });
      if (normalized.includes('FROM yuncms_permissions') && normalized.includes('WHERE role = ?')) {
        return [permission ? [permission] : [], []];
      }
      if (normalized.includes('GET_LOCK')) {
        return [[{ acquired: 1 }]];
      }
      if (normalized.includes('RELEASE_LOCK')) {
        return [[{ released: 1 }]];
      }
      if (normalized.includes('SELECT 1 AS present')) {
        return occupied ? [[{ present: 1 }]] : [[]];
      }
      if (normalized.startsWith('SELECT')) {
        return [[{ id: 'item-1', title: 'Existing' }]];
      }
      return [{ affectedRows: 1, insertId: 1 }];
    },
  };
  const pool = {
    calls,
    getConnection: async () => connection,
    query: connection.query,
  };
  return pool;
}

test('unauthorized createOne on occupied singleton rejects with FORBIDDEN without occupancy query or GET_LOCK', async () => {
  const database = createMockPool({ occupied: true });
  const service = new SingletonItemsService('site_settings', {
    database,
    schema: singletonSchema,
    accountability: { role: null, user: null, admin: false },
  });

  await assert.rejects(
    () => service.createOne({ title: 'New Settings' }),
    (error) => error.code === 'FORBIDDEN',
  );

  assert.equal(database.calls.some((c) => typeof c === 'object' && c.sql.includes('SELECT 1 AS present')), false);
  assert.equal(database.calls.some((c) => typeof c === 'object' && c.sql.includes('GET_LOCK')), false);
});

test('unauthorized createOne on empty singleton rejects with FORBIDDEN without occupancy query or GET_LOCK', async () => {
  const database = createMockPool({ occupied: false });
  const service = new SingletonItemsService('site_settings', {
    database,
    schema: singletonSchema,
    accountability: { role: null, user: null, admin: false },
  });

  await assert.rejects(
    () => service.createOne({ title: 'New Settings' }),
    (error) => error.code === 'FORBIDDEN',
  );

  assert.equal(database.calls.some((c) => typeof c === 'object' && c.sql.includes('SELECT 1 AS present')), false);
  assert.equal(database.calls.some((c) => typeof c === 'object' && c.sql.includes('GET_LOCK')), false);
});

test('unauthorized createMany on singleton rejects with FORBIDDEN without occupancy query, GET_LOCK, or cardinality disclosure', async () => {
  const database = createMockPool({ occupied: true });
  const service = new SingletonItemsService('site_settings', {
    database,
    schema: singletonSchema,
    accountability: { role: null, user: null, admin: false },
  });

  // Empty array (bad cardinality)
  await assert.rejects(
    () => service.createMany([]),
    (error) => error.code === 'FORBIDDEN',
  );
  assert.equal(database.calls.some((c) => typeof c === 'object' && c.sql.includes('SELECT 1 AS present')), false);
  assert.equal(database.calls.some((c) => typeof c === 'object' && c.sql.includes('GET_LOCK')), false);

  // Single item array (valid cardinality, but unauthorized)
  await assert.rejects(
    () => service.createMany([{ title: 'New Settings' }]),
    (error) => error.code === 'FORBIDDEN',
  );
  assert.equal(database.calls.some((c) => typeof c === 'object' && c.sql.includes('SELECT 1 AS present')), false);
  assert.equal(database.calls.some((c) => typeof c === 'object' && c.sql.includes('GET_LOCK')), false);
});

test('authorized createOne and createMany on occupied singleton rejects with SINGLETON_ITEM_EXISTS', async () => {
  const database = createMockPool({ occupied: true });
  const service = new SingletonItemsService('site_settings', {
    database,
    schema: singletonSchema,
    accountability: { role: 'admin', user: 'admin-user', admin: true },
  });

  await assert.rejects(
    () => service.createOne({ title: 'New Settings' }),
    (error) => error.code === 'SINGLETON_ITEM_EXISTS',
  );

  await assert.rejects(
    () => service.createMany([{ title: 'New Settings' }]),
    (error) => error.code === 'SINGLETON_ITEM_EXISTS',
  );
});

test('authorized createOne on vacant singleton succeeds and createMany validates cardinality', async () => {
  const database = createMockPool({ occupied: false });
  const service = new SingletonItemsService('site_settings', {
    database,
    schema: singletonSchema,
    accountability: { role: 'admin', user: 'admin-user', admin: true },
  });

  const created = await service.createOne({ title: 'New Settings' });
  assert.ok(created);

  // Authorized bulk with invalid cardinality throws SINGLETON_BULK_CREATE_FORBIDDEN
  await assert.rejects(
    () => service.createMany([]),
    (error) => error.code === 'SINGLETON_BULK_CREATE_FORBIDDEN',
  );
});

test('collection info errors preserved on singleton items service', async () => {
  const database = createMockPool({ occupied: false });
  const missingService = new SingletonItemsService('unknown_collection', {
    database,
    schema: singletonSchema,
    accountability: { role: null, user: null, admin: false },
  });
  await assert.rejects(
    () => missingService.createOne({ title: 'Test' }),
    (error) => error.code === 'COLLECTION_NOT_FOUND',
  );

  const systemService = new SingletonItemsService('yuncms_collections', {
    database,
    schema: singletonSchema,
    accountability: { role: null, user: null, admin: false },
  });
  await assert.rejects(
    () => systemService.createOne({ collection: 'test' }),
    (error) => error.code === 'SYSTEM_COLLECTION_USE_DEDICATED_SERVICE',
  );
});

test('non-singleton collections preserve native behavior without singleton locks or vacancy checks', async () => {
  const database = createMockPool({ occupied: true });
  const service = new SingletonItemsService('posts', {
    database,
    schema: singletonSchema,
    accountability: { role: null, user: null, admin: false },
  });

  await assert.rejects(
    () => service.createOne({ title: 'Post' }),
    (error) => error.code === 'FORBIDDEN',
  );
  assert.equal(database.calls.some((c) => typeof c === 'object' && c.sql.includes('SELECT 1 AS present')), false);
  assert.equal(database.calls.some((c) => typeof c === 'object' && c.sql.includes('GET_LOCK')), false);
});
