import assert from 'node:assert/strict';
import test from 'node:test';

import { createFixedWindowRateLimit } from '../src/rate-limit.js';

function response() {
  const headers = new Map();
  return {
    headers,
    set(name, value) { headers.set(name.toLowerCase(), String(value)); },
  };
}

function invoke(limiter, req) {
  let failure = null;
  const res = response();
  limiter(req, res, (error) => { failure = error ?? null; });
  return { failure, res };
}

test('fixed-window limiter allows budget then fails with retry metadata', () => {
  let timestamp = 1000;
  const limiter = createFixedWindowRateLimit({
    windowMs: 1000,
    max: 2,
    now: () => timestamp,
    key: () => 'client-1',
  });
  const req = { ip: '127.0.0.1' };

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const result = invoke(limiter, req);
    assert.equal(result.failure, null);
    assert.equal(result.res.headers.get('x-ratelimit-limit'), '2');
  }

  const limited = invoke(limiter, req);
  assert.equal(limited.failure.code, 'RATE_LIMITED');
  assert.equal(limited.res.headers.get('retry-after'), '1');

  timestamp = 2000;
  assert.equal(invoke(limiter, req).failure, null);
});

test('fixed-window limiter keeps unique-client bucket memory bounded', () => {
  const limiter = createFixedWindowRateLimit({
    windowMs: 60_000,
    max: 1,
    maxBuckets: 2,
    now: () => 1000,
    key: (req) => req.ip,
  });

  assert.equal(invoke(limiter, { ip: 'client-a' }).failure, null);
  assert.equal(invoke(limiter, { ip: 'client-a' }).failure.code, 'RATE_LIMITED');
  assert.equal(invoke(limiter, { ip: 'client-b' }).failure, null);
  assert.equal(invoke(limiter, { ip: 'client-c' }).failure, null);

  // Adding client-c must evict one old bucket rather than growing forever.
  // client-a is the oldest insertion and therefore gets a fresh bounded bucket.
  assert.equal(invoke(limiter, { ip: 'client-a' }).failure, null);
});

test('fixed-window limiter rejects an invalid bucket cap', () => {
  assert.throws(
    () => createFixedWindowRateLimit({ windowMs: 1000, max: 1, maxBuckets: 0 }),
    /maxBuckets must be a positive integer/,
  );
});
