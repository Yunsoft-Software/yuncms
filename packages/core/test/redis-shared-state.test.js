import assert from 'node:assert/strict';
import test from 'node:test';

import { RedisCacheStore, RedisFixedWindowStore, redactRedisUrl } from '../src/redis.js';

class FakeRedis {
  constructor() { this.values = new Map(); this.counts = new Map(); }
  async command(command, ...args) {
    if (command === 'GET') return this.values.get(args[0]) ?? null;
    if (command === 'SET') { this.values.set(args[0], args[1]); return 'OK'; }
    if (command === 'DEL') return this.values.delete(args[0]) ? 1 : 0;
    if (command === 'INCR') {
      const next = Number(this.values.get(args[0]) ?? 0) + 1;
      this.values.set(args[0], String(next));
      return next;
    }
    if (command === 'EVAL') {
      const key = args[2];
      const next = (this.counts.get(key) ?? 0) + 1;
      this.counts.set(key, next);
      return [next, Number(args[3])];
    }
    throw new Error(`Unsupported fake command ${command}`);
  }
}

test('redis permission cache uses generation invalidation rather than key scans', async () => {
  const client = new FakeRedis();
  const cacheA = new RedisCacheStore({ client, prefix: 'yuncms:test:' });
  const cacheB = new RedisCacheStore({ client, prefix: 'yuncms:test:' });
  await cacheA.set('role:articles:read', { fields: ['title'] });
  assert.deepEqual(await cacheB.get('role:articles:read'), { fields: ['title'] });
  await cacheA.clear();
  assert.equal(await cacheB.get('role:articles:read'), undefined);
});

test('redis fixed window hashes raw identities in keys', async () => {
  const client = new FakeRedis();
  const store = new RedisFixedWindowStore({ client, prefix: 'yuncms:test:' });
  const first = await store.consume('person@example.com', { windowMs: 60000, max: 2, scope: 'login' });
  const second = await store.consume('person@example.com', { windowMs: 60000, max: 2, scope: 'login' });
  assert.equal(first.count, 1);
  assert.equal(second.count, 2);
  assert.equal([...client.counts.keys()].some((key) => key.includes('person@example.com')), false);
});

test('redis URL redaction removes credentials', () => {
  const redacted = redactRedisUrl('rediss://alice:secret@example.test:6380/0');
  assert.doesNotMatch(redacted, /alice|secret/);
  assert.match(redacted, /example.test/);
});
