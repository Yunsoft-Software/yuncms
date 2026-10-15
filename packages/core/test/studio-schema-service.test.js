import assert from 'node:assert/strict';
import test from 'node:test';
import { studioCollectionDisplay, studioReadableFields } from '../src/services/studio-schema-service.js';

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
