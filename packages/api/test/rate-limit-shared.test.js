import assert from 'node:assert/strict';
import test from 'node:test';

import { createFixedWindowRateLimit } from '../src/rate-limit.js';

function response() {
  const headers = new Map();
  return { headers, set: (key, value) => headers.set(key, value) };
}

async function run(middleware, req) {
  const res = response();
  let error = null;
  await middleware(req, res, (value) => { error = value ?? null; });
  return { res, error };
}

test('shared rate limiter uses one external budget', async () => {
  let count = 0;
  const store = { async consume() { count += 1; return { count, resetAt: Date.now() + 1000, retryAfterMs: 1000 }; } };
  const limiter = createFixedWindowRateLimit({ windowMs: 1000, max: 1, store });
  assert.equal((await run(limiter, { ip: '1.2.3.4' })).error, null);
  assert.equal((await run(limiter, { ip: '1.2.3.4' })).error.code, 'RATE_LIMITED');
});

test('required shared limiter fails closed while best-effort falls back locally', async () => {
  const store = { async consume() { throw new Error('redis down'); } };
  const required = createFixedWindowRateLimit({ windowMs: 1000, max: 5, store, failureMode: 'required' });
  assert.equal((await run(required, { ip: '1.2.3.4' })).error.code, 'SHARED_RATE_LIMIT_UNAVAILABLE');

  const bestEffort = createFixedWindowRateLimit({ windowMs: 1000, max: 5, store, failureMode: 'best-effort', logger: { warn() {} } });
  assert.equal((await run(bestEffort, { ip: '1.2.3.4' })).error, null);
});
