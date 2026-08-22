import assert from 'node:assert/strict';
import test from 'node:test';

import { loadConfig } from '@yunsoft/yuncms-core';
import { createApiRateLimit, createApp } from '../src/app.js';

function fakePool() {
  return {
    async query() { return [[], []]; },
  };
}

function fakeResponse() {
  return {
    set() {},
  };
}

test('Express trusts no proxy by default', () => {
  const app = createApp({ pool: fakePool(), config: loadConfig({}) });
  assert.equal(app.get('trust proxy'), false);
});

test('Express applies the explicit trusted proxy hop count', () => {
  const app = createApp({
    pool: fakePool(),
    config: loadConfig({ TRUST_PROXY_HOPS: '1' }),
  });
  assert.equal(app.get('trust proxy'), 1);
});

test('global API limiter is wired from config and can be explicitly disabled', () => {
  assert.equal(
    createApiRateLimit(loadConfig({ API_RATE_LIMIT_ENABLED: 'false' })),
    null,
  );

  const limiter = createApiRateLimit(loadConfig({ API_RATE_LIMIT_MAX: '1' }));
  const req = { ip: 'client-1', socket: { remoteAddress: 'client-1' } };
  let firstError = null;
  limiter(req, fakeResponse(), (error) => { firstError = error ?? null; });
  assert.equal(firstError, null);

  let secondError = null;
  limiter(req, fakeResponse(), (error) => { secondError = error ?? null; });
  assert.equal(secondError?.code, 'RATE_LIMITED');
});
