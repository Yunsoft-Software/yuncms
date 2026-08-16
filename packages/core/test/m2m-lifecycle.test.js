import assert from 'node:assert/strict';
import test from 'node:test';

import { createPublicAccountability, createSystemAccountability } from '../src/accountability.js';
import { deleteM2MJunction } from '../src/m2m-lifecycle.js';

function forbiddenDatabase() {
  return {
    getConnection() {
      throw new Error('database must not be reached');
    },
  };
}

test('M2M delete rejects non-admin accountability before DB access', async () => {
  await assert.rejects(
    deleteM2MJunction({
      database: forbiddenDatabase(),
      accountability: createPublicAccountability(),
      junctionCollection: 'article_tags',
      destructive: true,
    }),
    (error) => error.code === 'FORBIDDEN',
  );
});

test('M2M delete requires explicit destructive intent before DB access', async () => {
  await assert.rejects(
    deleteM2MJunction({
      database: forbiddenDatabase(),
      accountability: createSystemAccountability(),
      junctionCollection: 'article_tags',
    }),
    (error) => error.code === 'DESTRUCTIVE_OPERATION_REQUIRED',
  );
});
