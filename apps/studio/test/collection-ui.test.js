import assert from 'node:assert/strict';
import test from 'node:test';

import { findCollectionIcons, normalizeCollectionIcon } from '../src/collection-icons.js';
import {
  collectionMetadataPatch,
  collectionUi,
  legacyCollectionSort,
  sortContentCollections,
} from '../src/collection-ui.js';

test('collection icon registry is searchable and unknown values fall back safely', () => {
  assert.equal(findCollectionIcons('factory').some((icon) => icon.id === 'factory'), true);
  assert.equal(findCollectionIcons('invoice').some((icon) => icon.id === 'money'), true);
  assert.equal(normalizeCollectionIcon('not-real'), 'collection');
});

test('content collections use metadata sort while hidden and system rows stay out of navigation', () => {
  const rows = [
    { collection: 'zeta', system: 0, hidden: 0, metadata: { sort: 20, icon: 'star' } },
    { collection: 'alpha', system: 0, hidden: 0, metadata: JSON.stringify({ sort: 10, icon: 'article' }) },
    { collection: 'hidden', system: 0, hidden: 1, metadata: { sort: 1 } },
    { collection: 'yuncms_users', system: 1, hidden: 0, metadata: { sort: 0 } },
  ];
  assert.deepEqual(sortContentCollections(rows).map((row) => row.collection), ['alpha', 'zeta']);
  assert.equal(collectionUi(rows[0]).icon, 'star');
});

test('legacy collections receive stable distinct sort values so first reorder can persist', () => {
  const alpha = legacyCollectionSort('alpha');
  const beta = legacyCollectionSort('beta');
  assert.equal(alpha, legacyCollectionSort('alpha'));
  assert.notEqual(alpha, beta);
  assert.equal(collectionUi({ collection: 'alpha', metadata: null }).sort, alpha);
});

test('collection metadata patches preserve unrelated metadata', () => {
  assert.deepEqual(
    collectionMetadataPatch({ metadata: { systemFields: ['created_at'], icon: 'collection' } }, { icon: 'cart', sort: 4 }),
    { systemFields: ['created_at'], icon: 'cart', sort: 4 },
  );
});
