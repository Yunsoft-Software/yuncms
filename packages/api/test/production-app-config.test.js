import assert from 'node:assert/strict';
import test from 'node:test';

import { loadConfig } from '@yunsoft/yuncms-core';
import { createApp } from '../src/app.js';

function fakePool() {
  return {
    async query() { return [[], []]; },
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
