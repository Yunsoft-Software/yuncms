import assert from 'node:assert/strict';
import test from 'node:test';

import {
  collectionVisibilityLabel,
  isContentCollection,
  isJunctionCollection,
  parseCollectionMetadata,
} from '../src/collection-visibility.js';

test('Content navigation excludes system and hidden collections', () => {
  assert.equal(isContentCollection({ collection: 'articles', system: 0, hidden: 0 }), true);
  assert.equal(isContentCollection({ collection: 'article_tags', system: 0, hidden: 1 }), false);
  assert.equal(isContentCollection({ collection: 'yuncms_users', system: 1, hidden: 0 }), false);
});

test('junction metadata works with object and JSON storage shapes', () => {
  assert.equal(isJunctionCollection({ metadata: { junction: true } }), true);
  assert.equal(isJunctionCollection({ metadata: '{"junction":true}' }), true);
  assert.equal(isJunctionCollection({ metadata: '{bad json' }), false);
  assert.deepEqual(parseCollectionMetadata(null), {});
});

test('collection visibility labels describe the actual hidden flag', () => {
  assert.equal(collectionVisibilityLabel({ hidden: 0 }), 'Visible in Content');
  assert.equal(collectionVisibilityLabel({ hidden: 1 }), 'Hidden from Content');
});
