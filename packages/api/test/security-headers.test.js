import assert from 'node:assert/strict';
import test from 'node:test';

import { securityHeaders } from '../src/app.js';
import { noStore } from '../src/routes/auth.js';

function responseRecorder() {
  const headers = new Map();
  return {
    headers,
    set(name, value) {
      headers.set(String(name).toLowerCase(), value);
      return this;
    },
  };
}

test('baseline API security headers fail closed for framing and MIME sniffing', () => {
  const res = responseRecorder();
  let nextCalled = false;
  securityHeaders({}, res, () => { nextCalled = true; });

  assert.equal(nextCalled, true);
  assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(res.headers.get('x-frame-options'), 'DENY');
  assert.equal(res.headers.get('referrer-policy'), 'no-referrer');
  assert.match(res.headers.get('permissions-policy'), /camera=\(\)/);
  assert.equal(res.headers.get('cross-origin-resource-policy'), 'same-origin');
});

test('authentication responses are marked no-store', () => {
  const res = responseRecorder();
  let nextCalled = false;
  noStore({}, res, () => { nextCalled = true; });

  assert.equal(nextCalled, true);
  assert.equal(res.headers.get('cache-control'), 'no-store');
  assert.equal(res.headers.get('pragma'), 'no-cache');
});
