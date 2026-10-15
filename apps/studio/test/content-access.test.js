import assert from 'node:assert/strict';
import test from 'node:test';
import { canWriteContent, contentWritableFields } from '../src/content-access.js';

test('Content controls fail closed and respect explicit action, row and field capabilities', () => {
  const capabilities = { create: { allowed: false }, update: { allowed: true, fields: ['title'] }, delete: { allowed: false }, records: { own: { update: true, delete: false }, other: { update: false } } };
  assert.equal(canWriteContent(null, 'create'), false); assert.equal(canWriteContent(capabilities, 'create'), false);
  assert.equal(canWriteContent(capabilities, 'update', 'own'), true); assert.equal(canWriteContent(capabilities, 'update', 'other'), false);
  assert.equal(canWriteContent(capabilities, 'delete', 'own'), false); assert.equal(canWriteContent(capabilities, 'update', 'constructor'), false);
  const fields = [{ field: 'id', readonly: true }, { field: 'title' }, { field: 'status' }];
  assert.deepEqual(contentWritableFields(fields, capabilities, 'update', field => field.readonly).map(field => field.field), ['title']);
  assert.deepEqual(contentWritableFields(fields, null, 'update', field => field.readonly), []);
});
