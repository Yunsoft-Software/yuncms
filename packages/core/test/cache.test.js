import assert from 'node:assert/strict';
import test from 'node:test';

import { isCacheStore, MemoryCacheStore } from '../src/cache.js';

test('memory cache stores values until TTL expiry', async () => {
  let timestamp = 1_000;
  const cache = new MemoryCacheStore({
    ttlMs: 100,
    maxEntries: 10,
    now: () => timestamp,
  });

  await cache.set('permission', { read: true });
  assert.deepEqual(await cache.get('permission'), { read: true });
  timestamp = 1_100;
  assert.equal(await cache.get('permission'), undefined);
  assert.equal(cache.size, 0);
});

test('memory cache stays bounded by evicting oldest live entry', async () => {
  const cache = new MemoryCacheStore({ ttlMs: 60_000, maxEntries: 2, now: () => 1_000 });
  await cache.set('a', 1);
  await cache.set('b', 2);
  await cache.set('c', 3);

  assert.equal(await cache.get('a'), undefined);
  assert.equal(await cache.get('b'), 2);
  assert.equal(await cache.get('c'), 3);
  assert.equal(cache.size, 2);
});

test('memory cache supports explicit invalidation', async () => {
  const cache = new MemoryCacheStore();
  await cache.set('a', 1);
  assert.equal(await cache.delete('a'), true);
  assert.equal(await cache.get('a'), undefined);

  await cache.set('b', 2);
  await cache.set('c', 3);
  await cache.clear();
  assert.equal(cache.size, 0);
});

test('cache store contract is duck typed for future shared-store adapters', () => {
  assert.equal(isCacheStore(new MemoryCacheStore()), true);
  assert.equal(isCacheStore(new Map()), true);
  assert.equal(isCacheStore({ get() {}, set() {}, delete() {}, clear() {} }), true);
  assert.equal(isCacheStore({ get() {}, set() {} }), false);
});
