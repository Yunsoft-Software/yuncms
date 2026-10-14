import assert from 'node:assert/strict';
import test from 'node:test';
import { createAccountability, createPublicAccountability, createSystemAccountability } from '../src/accountability.js';
import { StudioSchemaService } from '../src/services/studio-schema-service.js';

const schema = { version: 1, collections: {
  articles: { collection: 'articles', name: 'Articles', primary_key: 'id', metadata: { icon: 'book', secret: 'private' }, fields: {
    id: { field: 'id', type: 'uuid' }, title: { field: 'title', type: 'string' }, private_note: { field: 'private_note', type: 'string' },
  } },
  hidden_data: { collection: 'hidden_data', primary_key: 'id', fields: { id: { field: 'id', type: 'uuid' } } },
  yuncms_users: { collection: 'yuncms_users', system: true, fields: { password_hash: { field: 'password_hash' } } },
}, relations: [{ many_collection: 'articles', many_field: 'private_note', one_collection: 'hidden_data' }] };
function service(accountability) {
  return new StudioSchemaService({ accountability, schema, database: { async query(sql, params) {
    assert.match(sql, /FROM yuncms_permissions/);
    if (params[1] !== 'articles') return [[]];
    return [[{ role: 'reader', collection: 'articles', action: 'read', fields: ['id', 'title'], filter: null, validation: null }]];
  } } });
}
test('normal Studio users discover only their readable collections and field allowlist', async () => {
  const reader = service(createAccountability({ user: 'reader-user', role: 'reader' }));
  const collections = await reader.readCollections(); assert.deepEqual(collections.map(c => c.collection), ['articles']);
  assert.deepEqual(collections[0].metadata, { icon: 'book' });
  assert.deepEqual((await reader.readFields('articles')).map(f => f.field), ['id', 'title']);
  assert.deepEqual(await reader.readRelations(), []);
  await assert.rejects(reader.readFields('hidden_data'), { code: 'FORBIDDEN' });
  await assert.rejects(reader.readFields('yuncms_users'), { code: 'COLLECTION_NOT_FOUND' });
});
test('public callers cannot discover Studio metadata, while explicit system access remains supported', async () => {
  const publicService = service(createPublicAccountability());
  for (const call of [() => publicService.readCollections(), () => publicService.readFields('articles'), () => publicService.readRelations()]) await assert.rejects(call(), { code: 'FORBIDDEN' });
  assert.deepEqual((await service(createSystemAccountability()).readFields('articles')).map(f => f.field), ['id', 'title', 'private_note']);
});
