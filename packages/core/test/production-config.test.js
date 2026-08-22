import assert from 'node:assert/strict';
import test from 'node:test';

import { loadConfig } from '../src/config.js';

test('trusted proxy hops are disabled by default and explicitly bounded', () => {
  assert.equal(loadConfig({}).server.trustProxyHops, 0);
  assert.equal(loadConfig({ TRUST_PROXY_HOPS: '1' }).server.trustProxyHops, 1);
  assert.throws(() => loadConfig({ TRUST_PROXY_HOPS: '-1' }), /TRUST_PROXY_HOPS/);
  assert.throws(() => loadConfig({ TRUST_PROXY_HOPS: '11' }), /TRUST_PROXY_HOPS/);
});

test('global API rate limit is enabled with bounded production defaults', () => {
  const defaults = loadConfig({}).server.rateLimit;
  assert.deepEqual(defaults, {
    enabled: true,
    windowMs: 60_000,
    max: 300,
    maxBuckets: 10_000,
  });

  const disabled = loadConfig({ API_RATE_LIMIT_ENABLED: 'false' }).server.rateLimit;
  assert.equal(disabled.enabled, false);
});

test('production-sensitive boolean config fails closed on ambiguous values', () => {
  assert.throws(() => loadConfig({ DB_SSL: 'yes' }), /Expected boolean value/);
  assert.throws(() => loadConfig({ S3_FORCE_PATH_STYLE: 'sometimes' }), /Expected boolean value/);
  assert.throws(() => loadConfig({ API_RATE_LIMIT_ENABLED: 'sometimes' }), /Expected boolean value/);
});

test('resource limit configuration rejects unsafe ranges', () => {
  assert.throws(() => loadConfig({ FILES_MAX_UPLOAD_BYTES: '0' }), /FILES_MAX_UPLOAD_BYTES/);
  assert.throws(() => loadConfig({ DB_CONNECTION_LIMIT: '0' }), /DB_CONNECTION_LIMIT/);
  assert.throws(() => loadConfig({ AUTH_LOGIN_RATE_MAX: '0' }), /AUTH_LOGIN_RATE_MAX/);
  assert.throws(() => loadConfig({ API_RATE_LIMIT_MAX: '0' }), /API_RATE_LIMIT_MAX/);
  assert.throws(() => loadConfig({ API_RATE_LIMIT_MAX_BUCKETS: '0' }), /API_RATE_LIMIT_MAX_BUCKETS/);
});
