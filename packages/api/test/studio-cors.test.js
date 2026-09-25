import assert from 'node:assert/strict';
import test from 'node:test';

import { loadConfig } from '@yunsoft/yuncms-core';
import { createApp } from '../src/app.js';

const STUDIO_ORIGIN = 'https://studio.example.test';

function fakePool() {
  return {
    async query() { return [[], []]; },
  };
}

async function withServer(operation) {
  const app = createApp({
    pool: fakePool(),
    config: loadConfig({
      STUDIO_ORIGIN,
      API_RATE_LIMIT_ENABLED: 'false',
      AUTH_RATE_LIMIT_ENABLED: 'false',
    }),
  });
  const server = await new Promise((resolve, reject) => {
    const instance = app.listen(0, '127.0.0.1', () => resolve(instance));
    instance.once('error', reject);
  });

  try {
    const { port } = server.address();
    await operation(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

test('configured Studio origin can preflight PUT requests', async () => {
  await withServer(async (origin) => {
    const response = await fetch(`${origin}/extensions/example`, {
      method: 'OPTIONS',
      headers: {
        origin: STUDIO_ORIGIN,
        'access-control-request-method': 'PUT',
        'access-control-request-headers': 'authorization,content-type',
      },
    });

    assert.equal(response.status, 204);
    assert.equal(response.headers.get('access-control-allow-origin'), STUDIO_ORIGIN);
    assert.match(response.headers.get('access-control-allow-methods') || '', /(?:^|,)PUT(?:,|$)/);
    assert.match(response.headers.get('access-control-allow-headers') || '', /authorization/);
  });
});

test('Studio CORS does not reflect an unconfigured origin', async () => {
  await withServer(async (origin) => {
    const response = await fetch(`${origin}/extensions/example`, {
      method: 'OPTIONS',
      headers: {
        origin: 'https://untrusted.example.test',
        'access-control-request-method': 'PUT',
      },
    });

    assert.equal(response.status, 204);
    assert.equal(response.headers.get('access-control-allow-origin'), null);
    assert.equal(response.headers.get('access-control-allow-methods'), null);
  });
});
