import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { ITEM_REVISION, withEditState, editHeaders, contentDraftKey } from '../src/content-edit-state.js';
import { DICTIONARIES } from '../src/localization.js';
import { readStudioRoute, studioDestinationForRoute } from '../src/studio-route.js';
import { CONTENT_HISTORY_PAGE_SIZE, contentHistoryPage } from '../src/premium/content-history-page.js';

test('history paging never offers an empty page at the exact native page boundary', () => {
  const rows = Array.from({ length: 26 }, (_, index) => ({ revision: String(index + 1) }));
  assert.equal(CONTENT_HISTORY_PAGE_SIZE, 25);
  for (const count of [0, 1, 24, 25, 26]) {
    const page = contentHistoryPage(rows.slice(0, count));
    assert.deepEqual(page.rows, rows.slice(0, Math.min(count, 25)));
    assert.equal(page.hasNext, count > 25);
  }
});
test('edit revisions stay out of writable JSON and survive record normalization', () => {
  const record = withEditState({ data: { id: 'one', title: 'Draft' }, meta: { revision: '18446744073709551615' } }).data;
  assert.equal(record[ITEM_REVISION], '18446744073709551615');
  assert.equal(JSON.stringify(record), '{"id":"one","title":"Draft"}');
  assert.equal(editHeaders({ ...record })['x-yuncms-item-revision'], '18446744073709551615');
  const list = withEditState({ data: [{ code: 'tr' }, { code: 'en' }], meta: { primaryKey: 'code', revisions: { tr: '4', en: null } } });
  assert.equal(list.data[0][ITEM_REVISION], '4'); assert.equal(list.data[1][ITEM_REVISION], undefined);
  assert.equal(Object.hasOwn(editHeaders(list.data[1]), 'x-yuncms-item-revision'), false);
});
test('feature screen is a Settings destination and every enabled locale contains its labels', async () => {
  const route = readStudioRoute('#/features');
  assert.equal(route.section, 'features'); assert.equal(studioDestinationForRoute(route), 'settings');
  for (const dict of Object.values(DICTIONARIES)) for (const key of Object.keys(DICTIONARIES.en).filter(key => key.startsWith('features.'))) assert.ok(dict[key], key);
  const app = await readFile(new URL('../src/App.jsx', import.meta.url), 'utf8');
  assert.match(app, /id: 'features'.*adminOnly: true/);
  const content = await readFile(new URL('../src/screens/ContentScreen.jsx', import.meta.url), 'utf8');
  assert.match(content, /headers: editHeaders\(savedRecord\)/);
  assert.match(content, /onProgress: progress/);
});

test('feature styling is centrally imported before CSS rules so production bundlers retain it', async () => {
  const css = await readFile(new URL('../src/studio.css', import.meta.url), 'utf8');
  const featureImport = css.indexOf("@import './feature-settings.css'");
  assert.ok(featureImport >= 0 && featureImport < css.indexOf('.record-form-grid'));
});

test('reverted file/field selections and relation sets are clean; actual field changes remain dirty', () => {
  const original = contentDraftKey({ file: 'one', title: 'Saved' }, { tags: ['a', 'b'] });
  assert.equal(contentDraftKey({ title: 'Saved', file: 'one' }, { tags: ['b', 'a'] }), original);
  assert.notEqual(contentDraftKey({ file: '', title: 'Saved' }, { tags: ['a', 'b'] }), original);
  assert.notEqual(contentDraftKey({ file: 'one', title: 'Changed' }, { tags: ['a', 'b'] }), original);
  assert.equal(contentDraftKey({}, { rows: [{ id: null, deleted: true, _localId: 'new', values: {} }] }), contentDraftKey({}, { rows: [] }));
});

test('a scalar history restore preserves the dirty state of unsaved related edits', async () => {
  const savedChildren = { children: [{ id: 'child', values: { title: 'Saved' } }] };
  const draftChildren = { children: [{ id: 'child', values: { title: 'Unsaved child' } }] };
  assert.notEqual(contentDraftKey({ title: 'Restored parent' }, savedChildren), contentDraftKey({ title: 'Restored parent' }, draftChildren));
  const source = await readFile(new URL('../src/screens/ContentScreen.jsx', import.meta.url), 'utf8');
  assert.match(source, /setCleanKey\(contentDraftKey\(initialized, cleanNestedDraft\.current\)\)/);
});
