import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { contentEmptyState } from '../src/content-empty-state.js';

test('unselected visible collections prompt selection; only a truly empty list suggests creation', () => {
  assert.deepEqual(contentEmptyState(21), { title: 'content.selectCollection', description: 'content.selectCollectionDescription', canCreateCollection: false });
  assert.deepEqual(contentEmptyState(0), { title: 'content.noCollections', description: 'content.noCollectionsDescription', canCreateCollection: true });
});

test('React passes the visible collection count through the route and uses the selected empty-state actions', () => {
  const read = path => readFileSync(new URL(path, import.meta.url), 'utf8');
  assert.match(read('../src/App.jsx'), /visibleCollectionCount=\{contentCollections\.filter\(\(entry\) => !entry\.hidden\)\.length\}/);
  assert.match(read('../src/screens/ContentRouteScreen.jsx'), /visibleCollectionCount=\{visibleCollectionCount\}/);
  const screen = read('../src/screens/ContentScreen.jsx');
  assert.match(screen, /contentEmptyState\(visibleCollectionCount\)/);
  assert.match(screen, /t\(emptyState\.title\)/);
  assert.match(screen, /emptyState\.canCreateCollection && onOpenDataModel/);
});
