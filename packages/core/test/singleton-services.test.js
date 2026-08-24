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
