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
    let failure = null;
    const res = response();
    limiter(req, res, (error) => { failure = error ?? null; });
    assert.equal(failure, null);
    assert.equal(res.headers.get('x-ratelimit-limit'), '2');
  }

  let limited = null;
  const res = response();
  limiter(req, res, (error) => { limited = error; });
  assert.equal(limited.code, 'RATE_LIMITED');
  assert.equal(res.headers.get('retry-after'), '1');

  timestamp = 2000;
  let afterReset = null;
  limiter(req, response(), (error) => { afterReset = error ?? null; });
  assert.equal(afterReset, null);
});
