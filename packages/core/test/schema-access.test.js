import assert from 'node:assert/strict';
import test from 'node:test';

import { createPublicAccountability } from '../src/accountability.js';
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

const options = () => ({
  accountability: createPublicAccountability(),
  database: forbiddenDatabase(),
});

test('collection schema service rejects non-admin accountability before DB access', async () => {
  await assert.rejects(
    new CollectionsService(options()).readMany(),
    (error) => error.code === 'FORBIDDEN',
  );
});

test('field schema service rejects non-admin accountability before DB access', async () => {
  await assert.rejects(
    new FieldsService(options()).readMany('articles'),
    (error) => error.code === 'FORBIDDEN',
  );
});

test('relation schema service rejects non-admin accountability before DB access', async () => {
  await assert.rejects(
    new RelationsService(options()).readMany(),
    (error) => error.code === 'FORBIDDEN',
  );
});
