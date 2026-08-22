import assert from 'node:assert/strict';
import test from 'node:test';

import {
  assertYunCmsStopped,
  localYunCmsHealthUrl,
} from '../src/service-state.js';

test('service health URL maps wildcard binds to loopback and preserves explicit hosts', () => {
  assert.equal(
    localYunCmsHealthUrl({ host: '0.0.0.0', port: 3008 }),
    'http://127.0.0.1:3008/health',
  );
  assert.equal(
    localYunCmsHealthUrl({ host: '::', port: 3008 }),
    'http://127.0.0.1:3008/health',
  );
  assert.equal(
    localYunCmsHealthUrl({ host: '192.168.1.20', port: 3008 }),
    'http://192.168.1.20:3008/health',
  );
  assert.equal(
    localYunCmsHealthUrl({ host: '::1', port: 3008 }),
    'http://[::1]:3008/health',
  );
});

test('stopped-service guard fails closed when configured endpoint is reachable', async () => {
  let requested = null;
  await assert.rejects(
    assertYunCmsStopped({
      host: '10.0.0.5',
      port: 3008,
      async fetchFn(url) {
        requested = url;
        return { status: 200 };
      },
    }),
    (error) => error.code === 'UPDATE_APPLICATION_RUNNING',
  );
  assert.equal(requested, 'http://10.0.0.5:3008/health');
});
