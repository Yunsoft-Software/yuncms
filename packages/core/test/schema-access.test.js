import assert from 'node:assert/strict';
import test from 'node:test';

import { createAccountability, createPublicAccountability } from '../src/accountability.js';
import { CollectionsService } from '../src/services/collections-service.js';
import { FieldsService } from '../src/services/fields-service.js';
import { RelationsService } from '../src/services/relations-service.js';

function forbiddenDatabase() {
  return {
    query() {
      throw new Error('schema service must reject before touching the database');
    },
  };
}

const publicOptions = () => ({
  accountability: createPublicAccountability(),
  database: forbiddenDatabase(),
});

const adminOptions = () => ({
  accountability: createAccountability({
    user: '11111111-1111-1111-1111-111111111111',
    role: '22222222-2222-2222-2222-222222222222',
    admin: true,
  }),
  database: forbiddenDatabase(),
});

test('collection schema service rejects non-admin accountability before DB access', async () => {
  await assert.rejects(
    new CollectionsService(publicOptions()).readMany(),
    (error) => error.code === 'FORBIDDEN',
  );
});

test('field schema service rejects non-admin accountability before DB access', async () => {
  await assert.rejects(
    new FieldsService(publicOptions()).readMany('articles'),
    (error) => error.code === 'FORBIDDEN',
  );
});

test('relation schema service rejects non-admin accountability before DB access', async () => {
  await assert.rejects(
    new RelationsService(publicOptions()).readMany(),
    (error) => error.code === 'FORBIDDEN',
  );
});

test('collection delete requires explicit destructive intent before DB access', async () => {
  await assert.rejects(
    new CollectionsService(adminOptions()).deleteOne('articles'),
    (error) => error.code === 'DESTRUCTIVE_OPERATION_REQUIRED',
  );
});

test('field delete requires explicit destructive intent before DB access', async () => {
  await assert.rejects(
    new FieldsService(adminOptions()).deleteOne('articles', 'title'),
    (error) => error.code === 'DESTRUCTIVE_OPERATION_REQUIRED',
  );
});
