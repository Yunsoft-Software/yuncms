import assert from 'node:assert/strict';
import test from 'node:test';

import { createSystemAccountability } from '@yunsoft/yuncms-core';

import { createApp } from '../src/app.js';

class AuthService {
  async resolvePublicAccountability() {
    return createSystemAccountability();
  }
}

class CollectionsService {
  async createOne(input) {
    return { collection: input.collection };
  }
}

class FieldsService {
  async createOne(collection, input) {
    return { collection, field: input.field, type: input.type };
  }
}

class AuditService {
  async record() {}
}

test('successful API schema mutations clear the shared schema cache', async () => {
  let clears = 0;
  const schemaCache = {
    async get() {
      return { version: 1, collections: {}, relations: [] };
    },
    clear() {
      clears += 1;
    },
  };
  const serviceRegistry = {
    toObject() {
      return {
        AuthService,
        CollectionsService,
        FieldsService,
        AuditService,
      };
    },
  };
  const app = createApp({
    pool: {},
    config: {
      server: { studioOrigin: 'http://127.0.0.1:3008', trustProxyHops: 0 },
      storage: { maxUploadBytes: 1024 },
    },
    serviceRegistry,
    schemaCache,
    logger: { info() {}, warn() {}, error() {} },
  });
  const server = await new Promise((resolve, reject) => {
    const instance = app.listen(0, '127.0.0.1', () => resolve(instance));
    instance.once('error', reject);
  });

  try {
    const address = server.address();
    const origin = `http://127.0.0.1:${address.port}`;
    const collection = await fetch(`${origin}/schema/collections`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ collection: 'articles' }),
    });
    assert.equal(collection.status, 201);
    assert.equal(clears, 1);

    const field = await fetch(`${origin}/schema/collections/articles/fields`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ field: 'title', type: 'string' }),
    });
    assert.equal(field.status, 201);
    assert.equal(clears, 2);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
