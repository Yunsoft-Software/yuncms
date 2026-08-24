import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildNavigationModel,
  collectionDropPatches,
  groupDropPatches,
  navigationAppendPatches,
  navigationDropPatches,
  navigationPointerPosition,
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

test('navigation model interleaves root collections and folders by one shared sort order', () => {
  const model = buildNavigationModel([
    collection('articles', { sort: 20 }),
    collection('pages', { sort: 10, group: 'site' }),
    collection('settings', { sort: 30 }),
  ], [{ id: 'site', name: 'Site', sort: 10, collapse: 'closed' }]);

  assert.deepEqual(model.nodes.map((node) => `${node.type}:${node.id}`), [
    'group:site',
    'collection:articles',
    'collection:settings',
  ]);
  assert.equal(model.groups[0].collapse, 'closed');
});

test('dropping a root collection inside a folder updates parent and both sort domains', () => {
  assert.deepEqual(navigationDropPatches([
    collection('articles', { sort: 10 }),
    collection('pages', { sort: 10, group: 'site' }),
    collection('menus', { sort: 20, group: 'site' }),
  ], [{ id: 'site', name: 'Site', sort: 20 }],
  { type: 'collection', id: 'articles' },
  { type: 'group', id: 'site', position: 'inside' }), {
    collections: [{ collection: 'articles', group: 'site', sort: 30 }],
    groups: [{ id: 'site', sort: 10 }],
  });
});

test('root collections and folders can be reordered relative to each other', () => {
  assert.deepEqual(navigationDropPatches([
    collection('articles', { sort: 10 }),
    collection('pages', { sort: 30 }),
  ], [{ id: 'site', name: 'Site', sort: 20 }],
  { type: 'group', id: 'site' },
  { type: 'collection', id: 'pages', position: 'after' }), {
    collections: [{ collection: 'pages', group: null, sort: 20 }],
    groups: [{ id: 'site', sort: 30 }],
  });
});

test('appending a folder normalizes legacy collection sort values into the bounded shared order', () => {
  assert.deepEqual(navigationAppendPatches([
    { collection: 'legacy', system: false, metadata: {} },
  ], [{ id: 'site', name: 'Site', sort: 10 }]), {
    collections: [{ collection: 'legacy', group: null, sort: 20 }],
    groups: [],
    sort: 30,
  });
});

test('pointer geometry exposes distinct before, inside and after drop zones', () => {
  const row = { top: 100, height: 80, allowInside: true };
  assert.equal(navigationPointerPosition({ ...row, clientY: 108 }), 'before');
  assert.equal(navigationPointerPosition({ ...row, clientY: 140 }), 'inside');
  assert.equal(navigationPointerPosition({ ...row, clientY: 176 }), 'after');
  assert.equal(navigationPointerPosition({ ...row, clientY: 140, allowInside: false }), 'after');
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
