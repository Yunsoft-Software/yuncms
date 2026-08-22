import assert from 'node:assert/strict';
import test from 'node:test';

import { CONTENT_SECURITY_POLICY, securityHeaders } from '../src/app.js';
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
  securityHeaders({ secure: false }, res, () => { nextCalled = true; });

  assert.equal(nextCalled, true);
  assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(res.headers.get('x-frame-options'), 'DENY');
  assert.equal(res.headers.get('referrer-policy'), 'no-referrer');
  assert.match(res.headers.get('permissions-policy'), /camera=\(\)/);
  assert.equal(res.headers.get('cross-origin-resource-policy'), 'same-origin');
  assert.equal(res.headers.get('cross-origin-opener-policy'), 'same-origin');
  assert.equal(res.headers.get('x-dns-prefetch-control'), 'off');
  assert.equal(res.headers.get('content-security-policy'), CONTENT_SECURITY_POLICY);
  assert.match(CONTENT_SECURITY_POLICY, /object-src 'none'/);
  assert.match(CONTENT_SECURITY_POLICY, /frame-ancestors 'none'/);
  assert.equal(res.headers.has('strict-transport-security'), false);
});

test('secure requests receive HSTS', () => {
  const res = responseRecorder();
  securityHeaders({ secure: true }, res, () => {});

  assert.equal(
    res.headers.get('strict-transport-security'),
    'max-age=15552000; includeSubDomains',
  );
});

test('authentication responses are marked no-store', () => {
  const res = responseRecorder();
  let nextCalled = false;
  noStore({}, res, () => { nextCalled = true; });

  assert.equal(nextCalled, true);
  assert.equal(res.headers.get('cache-control'), 'no-store');
  assert.equal(res.headers.get('pragma'), 'no-cache');
});
