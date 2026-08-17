import assert from 'node:assert/strict';
import test from 'node:test';

import { requestIdentity } from '../src/app.js';

function runRequestIdentity(requestId) {
  const headers = new Map();
  const req = {
    id: null,
    get(name) {
      return String(name).toLowerCase() === 'x-request-id' ? requestId : null;
    },
  };
  const res = {
    set(name, value) {
      headers.set(String(name).toLowerCase(), value);
      return this;
    },
  };
  let nextCalled = false;
  requestIdentity(req, res, () => { nextCalled = true; });
  return { req, headers, nextCalled };
}

test('request identity preserves a bounded safe caller id', () => {
  const result = runRequestIdentity('codex-test:123');
  assert.equal(result.nextCalled, true);
  assert.equal(result.req.id, 'codex-test:123');
  assert.equal(result.headers.get('x-request-id'), 'codex-test:123');
});

test('request identity replaces unsafe or oversized caller ids', () => {
  for (const value of ['bad id with spaces', 'bad\nheader', 'x'.repeat(65)]) {
    const result = runRequestIdentity(value);
    assert.match(result.req.id, /^[0-9a-f-]{36}$/i);
    assert.equal(result.headers.get('x-request-id'), result.req.id);
  }
});
