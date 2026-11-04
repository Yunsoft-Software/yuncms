import assert from 'node:assert/strict';
import test from 'node:test';
import { canWriteContent, contentRecordValuesKey, contentWritableFields, translatedRelationLabel } from '../src/content-access.js';
import { readFileSync } from 'node:fs';

test('relation labels prefer one readable translation in the current Studio language', () => {
  const rows = [{ languages_code: 'en-US', name: 'Technology' }, { language_code: 'tr-TR', name: 'Teknoloji' }];
  assert.equal(translatedRelationLabel(rows, 'tr'), 'Teknoloji');
  assert.equal(translatedRelationLabel(rows, 'en-GB'), 'Technology');
  assert.equal(translatedRelationLabel(rows, 'de'), 'Technology');
  assert.equal(translatedRelationLabel([{ language_code: 'tr', name: '' }, rows[0]], 'tr'), 'Technology');
  assert.equal(translatedRelationLabel([], 'tr', 'record-id'), 'record-id');
});

test('Content controls fail closed and respect explicit action, row and field capabilities', () => {
  const capabilities = { create: { allowed: false }, update: { allowed: true, fields: ['title'] }, delete: { allowed: false }, records: { own: { update: true, delete: false }, other: { update: false } } };
  assert.equal(canWriteContent(null, 'create'), false); assert.equal(canWriteContent(capabilities, 'create'), false);
  assert.equal(canWriteContent(capabilities, 'update', 'own'), true); assert.equal(canWriteContent(capabilities, 'update', 'other'), false);
  assert.equal(canWriteContent(capabilities, 'delete', 'own'), false); assert.equal(canWriteContent(capabilities, 'update', 'constructor'), false);
  const fields = [{ field: 'id', readonly: true }, { field: 'title' }, { field: 'status' }];
  assert.deepEqual(contentWritableFields(fields, capabilities, 'update', field => field.readonly).map(field => field.field), ['title']);
  assert.deepEqual(contentWritableFields(fields, null, 'update', field => field.readonly), []);
});

test('equivalent native record snapshots preserve a draft while changed identity or editable values refresh it', () => {
  const fields = [{ field: 'title' }, { field: 'status' }], record = { id: 'first', title: 'Title', status: 'draft', updated_at: 'old' };
  const key = contentRecordValuesKey(record, fields);
  assert.equal(contentRecordValuesKey({ ...record, updated_at: 'new' }, fields), key);
  assert.equal(contentRecordValuesKey({ ...record }, fields.map(field => ({ ...field }))), key);
  assert.notEqual(contentRecordValuesKey({ ...record, id: 'second' }, fields), key);
  assert.notEqual(contentRecordValuesKey({ ...record, status: 'review' }, fields), key);
  assert.notEqual(contentRecordValuesKey(record, [{ field: 'title', type: 'text' }, fields[1]]), key);
  assert.match(readFileSync(new URL('../src/screens/ContentScreen.jsx', import.meta.url), 'utf8'), /\[recordValuesKey\]/);
  const source = readFileSync(new URL('../src/screens/ContentScreen.jsx', import.meta.url), 'utf8');
  assert.match(source, /useState\(initialValues\)/);
  assert.match(source, /useLayoutEffect\(\(\) => \{\s*const initialized = initialValues\(\);\s*setValues\(initialized\)/);
  assert.match(source, /setCleanKey\(contentDraftKey\(initialized, cleanNestedDraft\.current\)\)/);
  assert.doesNotMatch(source, /setValues\([^\n]*event\.(?:target|currentTarget)/);
  assert.match(source, /disabled=\{!canSave \|\| saving\}/);
});


test('junction foreign keys retain native relation lookups for readable labels and pickers', async () => {
  const { directContentRelations } = await import('../src/content-access.js');
  const rows = [{ many_collection: 'article_tags', many_field: 'article_id', one_collection: 'articles', junction_collection: 'article_tags' }, { many_collection: 'article_tags', many_field: 'tag_id', one_collection: 'tags', junction_collection: 'article_tags' }, { many_collection: 'other', many_field: 'tag_id', one_collection: 'tags' }];
  assert.deepEqual(directContentRelations('article_tags', rows), rows.slice(0, 2));
});
