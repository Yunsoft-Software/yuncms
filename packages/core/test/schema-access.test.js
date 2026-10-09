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

test('dynamic M2O relations preserve system schema protection even for administrators', async () => {
  for (const target of ['yuncms_users', 'yuncms_roles', 'yuncms_files']) {
    const calls = [];
    let released = false;
    const connection = {
      async query(sql, params) {
        calls.push(sql);
        if (sql.includes('GET_LOCK')) return [[{ acquired: 1 }]];
        if (sql.includes('RELEASE_LOCK')) return [[{ released: 1 }]];
        if (sql.includes('FROM yuncms_collections')) {
          return [[{ collection: params[0], primary_key: 'id', system: params[0] === target ? 1 : 0 }]];
        }
        throw new Error(`Unexpected database access: ${sql}`);
      },
      release() { released = true; },
    };
    const service = new RelationsService({ ...adminOptions(), database: { async getConnection() { return connection; } } });
    await assert.rejects(
      service.createM2O({ manyCollection: 'memberships', manyField: 'user_id', oneCollection: target }),
      (error) => error.code === 'SYSTEM_SCHEMA_READ_ONLY',
    );
    assert.equal(calls.some((sql) => /ALTER TABLE|INSERT|DELETE/.test(sql)), false);
    assert.equal(released, true);
    assert.equal(calls.some((sql) => sql.includes('RELEASE_LOCK')), true);
  }
});

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

test('collection metadata requires real booleans for visibility flags', async () => {
  const service = new CollectionsService(adminOptions());
  await assert.rejects(
    service.updateOne('articles', { hidden: 'false' }),
    (error) => error.code === 'INVALID_SCHEMA_PAYLOAD',
  );
  await assert.rejects(
    service.createOne({ collection: 'articles', hidden: 1 }),
    (error) => error.code === 'INVALID_SCHEMA_PAYLOAD',
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

test('self M2M requires distinct explicit junction field names before DB access', async () => {
  await assert.rejects(
    new RelationsService(adminOptions()).createM2M({
      junctionCollection: 'article_links',
      leftCollection: 'articles',
      rightCollection: 'articles',
    }),
    (error) => error.code === 'INVALID_SCHEMA_PAYLOAD',
  );
});

test('M2M rejects SET NULL because junction FK fields are required', async () => {
  await assert.rejects(
    new RelationsService(adminOptions()).createM2M({
      junctionCollection: 'article_tags',
      leftCollection: 'articles',
      rightCollection: 'tags',
      leftOnDelete: 'SET NULL',
    }),
    (error) => error.code === 'INVALID_ON_DELETE',
  );
});
