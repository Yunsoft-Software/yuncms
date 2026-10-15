import assert from 'node:assert/strict';
import test from 'node:test';
import { studioCollectionDisplay, studioReadableFields, validateStudioCapabilityIds } from '../src/services/studio-schema-service.js';

const collection = { collection: 'articles', name: 'Articles', primary_key: 'id', metadata: { icon: 'book', secret: 'private' }, fields: {
  id: { field: 'id', type: 'uuid', readonly: true }, title: { field: 'title', type: 'string' }, private_note: { field: 'private_note', type: 'string' },
} };
test('Studio display metadata excludes non-navigation properties without a database substitute', () => {
  assert.deepEqual(studioCollectionDisplay(collection).metadata, { icon: 'book' });
  assert.equal(studioCollectionDisplay(collection).primary_key, 'id');
});
test('Studio field projection retains the primary key and only the resolved readable field mask', () => {
  assert.deepEqual(studioReadableFields(collection, { fields: ['title'] }).map(field => field.field), ['id', 'title']);
  assert.deepEqual(studioReadableFields(collection, { fields: null }).map(field => field.field), ['id', 'title', 'private_note']);
});

test('capability ids reject numeric overflow and malformed batches before SQL while keeping finite ids valid', () => {
  for (const ids of [[Infinity], [-Infinity], [NaN], [null], [{}], [''], ['x'.repeat(192)], Array(101).fill(1), {}]) assert.throws(() => validateStudioCapabilityIds(ids), { code: 'INVALID_QUERY' });
  for (const ids of [[], ['record'], [0, 42, 'uuid-value']]) assert.doesNotThrow(() => validateStudioCapabilityIds(ids));
});
