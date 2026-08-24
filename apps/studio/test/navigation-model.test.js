import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildNavigationModel,
  collectionDropPatches,
  groupDropPatches,
} from '../src/navigation-model.js';

function collection(name, { sort = 10, group = null, hidden = false } = {}) {
  return {
    collection: name,
    system: false,
    hidden,
    metadata: { sort, ...(group ? { group } : {}) },
  };
}

test('navigation model keeps hidden collections for Data Model and groups collections one level deep', () => {
  const model = buildNavigationModel([
    collection('articles', { sort: 20 }),
    collection('settings', { sort: 10, group: 'content', hidden: true }),
    collection('pages', { sort: 20, group: 'content' }),
  ], [{ id: 'content', name: 'Content', sort: 10 }]);
  assert.deepEqual(model.roots.map((entry) => entry.collection), ['articles']);
  assert.deepEqual(model.groups[0].collections.map((entry) => entry.collection), ['settings', 'pages']);

  const visible = buildNavigationModel([
    collection('settings', { group: 'content', hidden: true }),
    collection('pages', { group: 'content' }),
  ], [{ id: 'content', name: 'Content', sort: 10 }], { includeHidden: false });
  assert.deepEqual(visible.groups[0].collections.map((entry) => entry.collection), ['pages']);
});

test('dropping a collection onto another collection adopts its group and produces stable sort values', () => {
  const patches = collectionDropPatches([
    collection('articles', { sort: 10 }),
    collection('pages', { sort: 10, group: 'site' }),
    collection('menus', { sort: 20, group: 'site' }),
  ], 'articles', { targetName: 'menus' });
  assert.deepEqual(patches, [
    { collection: 'pages', group: 'site', sort: 10 },
    { collection: 'articles', group: 'site', sort: 20 },
    { collection: 'menus', group: 'site', sort: 30 },
  ]);
});

test('dropping a collection on the root removes its navigation group', () => {
  const patches = collectionDropPatches([
    collection('pages', { sort: 10 }),
    collection('articles', { sort: 20, group: 'site' }),
  ], 'articles', { groupId: null });
  assert.deepEqual(patches, [
    { collection: 'pages', group: null, sort: 10 },
    { collection: 'articles', group: null, sort: 20 },
  ]);
});

test('navigation groups can be reordered independently of collections', () => {
  assert.deepEqual(groupDropPatches([
    { id: 'a', name: 'A', sort: 10 },
    { id: 'b', name: 'B', sort: 20 },
    { id: 'c', name: 'C', sort: 30 },
  ], 'c', 'a'), [
    { id: 'c', sort: 10 },
    { id: 'a', sort: 20 },
    { id: 'b', sort: 30 },
  ]);
});
