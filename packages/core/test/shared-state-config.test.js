import assert from 'node:assert/strict';
import test from 'node:test';

import { loadConfig } from '../src/config.js';

test('memory remains the default shared-state mode', () => {
  const config = loadConfig({});
  assert.equal(config.cache.store, 'memory');
  assert.equal(config.server.rateLimit.store, 'memory');
  assert.equal(config.auth.rateLimit.store, 'memory');
  assert.equal(config.redis.url, null);
});

test('redis stores require an explicit redis URL and preserve safe prefix config', () => {
  assert.throws(() => loadConfig({ CACHE_STORE: 'redis' }), /REDIS_URL is required/);
  const config = loadConfig({
    CACHE_STORE: 'redis',
    API_RATE_LIMIT_STORE: 'redis',
    AUTH_RATE_LIMIT_STORE: 'redis',
    REDIS_URL: 'rediss://user:secret@redis.example.test:6380/0',
    REDIS_PREFIX: 'yuncms:prod-a:',
    REDIS_REQUIRED: 'true',
  });
  assert.equal(config.cache.store, 'redis');
  assert.equal(config.redis.prefix, 'yuncms:prod-a:');
  assert.equal(config.redis.required, true);
});
