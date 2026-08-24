import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';

const SRC = resolve(import.meta.dirname, '../src');
const screenSource = readFileSync(resolve(SRC, 'screens/DataModelV2Screen.jsx'), 'utf8');
const entrySource = readFileSync(resolve(SRC, 'screens/DataModelScreen.jsx'), 'utf8');
const css = readFileSync(resolve(SRC, 'data-model-v2.css'), 'utf8');
const interactionCss = readFileSync(resolve(SRC, 'data-model-v2-interactions.css'), 'utf8');
const mainSource = readFileSync(resolve(SRC, 'main.jsx'), 'utf8');

test('Data Model entry routes the compact home and collection workspace independently', () => {
  assert.match(entrySource, /view === 'collections'/);
  assert.match(entrySource, /return <DataModelHomeScreen/);
  assert.match(entrySource, /return <DataModelV2Screen/);
  assert.match(screenSource, /data-model-v2-layout/);
  assert.match(screenSource, /data-model-collection-list/);
  assert.doesNotMatch(screenSource, /<Pagination/);
});

test('collection creation keeps human display name separate from stable API key', () => {
  assert.match(screenSource, /dataModel\.displayName/);
  assert.match(screenSource, /dataModel\.apiKey/);
  assert.match(screenSource, /schemaKeyFromName\(value, 'collection'\)/);
  assert.match(screenSource, /name:\s*displayName/);
  assert.match(screenSource, /collection:\s*key/);
  assert.match(screenSource, /displaySchemaName\(selectedCollection, 'collection'\)/);
});

test('collection visibility, icon and sidebar ordering live inside Data Model overview', () => {
  assert.match(screenSource, /showInContent/);
  assert.match(screenSource, /CollectionIconPicker/);
  assert.match(screenSource, /moveCollection\(-1\)/);
  assert.match(screenSource, /moveCollection\(1\)/);
  assert.match(screenSource, /collectionMetadataPatch/);
  assert.match(screenSource, /hidden:\s*!overview\.visible/);
  assert.match(screenSource, /name:\s*overview\.name\.trim\(\)/);
});

test('collection ordering supports drag and drop and persists normalized sort slots', () => {
  assert.match(screenSource, /draggable=\{!search\.trim\(\)\}/);
  assert.match(screenSource, /onDragStart/);
  assert.match(screenSource, /onDrop/);
  assert.match(screenSource, /persistProjectOrder/);
  assert.match(screenSource, /sort:\s*\(index \+ 1\) \* 10/);
  assert.match(mainSource, /data-model-v2-interactions\.css/);
  assert.match(interactionCss, /\.collection-drag-handle/);
  assert.match(interactionCss, /cursor:\s*grab/);
});

test('collection workspace separates overview, fields and relations', () => {
  for (const tab of ['overview', 'fields', 'relations']) {
    assert.ok(screenSource.includes(`'${tab}'`), `missing ${tab} workspace tab`);
  }
  assert.match(screenSource, /<FieldBuilder/);
  assert.match(screenSource, /relation-type-picker/);
});

test('registered system collections can add bounded optional custom fields through the dedicated route', () => {
  assert.match(screenSource, /selectedCollection\.system/);
  assert.match(screenSource, /\/schema\/system-collections\/\$\{encodeURIComponent\(selected\)\}\/fields/);
  assert.match(screenSource, /allowRequired=\{!selectedCollection\.system\}/);
  assert.match(screenSource, /dataModel\.customSystemField/);
});

test('field list shows human labels alongside technical keys', () => {
  assert.match(screenSource, /displaySchemaName\(field, 'field'\)/);
  assert.match(screenSource, /<code>\{field\.field\}<\/code>/);
  assert.match(screenSource, /\[field\.name, field\.field, fieldDisplayType\(field\)\]/);
});

test('relation workspace preserves delete actions while simplifying layout', () => {
  assert.match(screenSource, /deleteDirectRelation/);
  assert.match(screenSource, /deleteM2M/);
  assert.match(screenSource, /\/schema\/relations\/\$\{kind\}/);
  assert.match(screenSource, /\/schema\/relations\/m2m\//);
  assert.match(interactionCss, /\.relation-v2-row \.danger-button/);
});

test('Data Model V2 surfaces use theme variables instead of hard-coded white backgrounds', () => {
  assert.match(css, /background:\s*var\(--studio-surface\)/);
  assert.match(css, /background:\s*var\(--studio-surface-muted\)/);
  assert.doesNotMatch(css, /background(?:-color)?:\s*(?:#fff(?:fff)?|white)\b/i);
  assert.doesNotMatch(interactionCss, /background(?:-color)?:\s*(?:#fff(?:fff)?|white)\b/i);
});
