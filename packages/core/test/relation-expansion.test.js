import assert from 'node:assert/strict';
import test from 'node:test';

import { readManyWithRelations } from '../src/relation-expansion.js';

const schema = {
  collections: {
    articles: {
      collection: 'articles',
      primary_key: 'id',
      fields: {
        id: { field: 'id', type: 'uuid' },
        author_id: { field: 'author_id', type: 'uuid' },
      },
    },
    authors: {
      collection: 'authors',
      primary_key: 'id',
      fields: {
        id: { field: 'id', type: 'uuid' },
        name: { field: 'name', type: 'string' },
      },
    },
  },
  relationByManyField: new Map([
    ['articles.author_id', {
      many_collection: 'articles',
      many_field: 'author_id',
      one_collection: 'authors',
      one_field: 'id',
      junction_collection: null,
      metadata: JSON.stringify({ kind: 'm2o' }),
    }],
  ]),
};

class FakeItemsService {
  constructor(collection) {
    this.collection = collection;
  }

  async resolvePermission() {
    return this.collection === 'articles'
      ? { fields: null }
      : { fields: null };
  }

  async readManyWithMeta(query) {
    assert.equal(this.collection, 'articles');
    assert.deepEqual(query.fields, ['id', 'author_id']);
    return {
      data: [{ id: 'article-1', author_id: 'author-1' }],
      meta: { total_count: 1, limit: 100, offset: 0 },
    };
  }

  async readMany(query) {
    assert.equal(this.collection, 'authors');
    assert.deepEqual(query.filter, { id: { _in: ['author-1'] } });
    return [{ id: 'author-1', name: 'Ada' }];
  }
}

test('direct M2O expansion replaces the FK with an authorized target record', async () => {
  const result = await readManyWithRelations({
    collection: 'articles',
    query: { fields: 'id', expand: 'author_id' },
    options: { schema, database: {} },
    ItemsServiceClass: FakeItemsService,
  });

  assert.deepEqual(result.data, [{
    id: 'article-1',
    author_id: { id: 'author-1', name: 'Ada' },
  }]);
});

test('source field allowlist is checked before expansion', async () => {
  class RestrictedItemsService extends FakeItemsService {
    async resolvePermission() {
      if (this.collection === 'articles') return { fields: ['id'] };
      return { fields: null };
    }
  }

  await assert.rejects(
    readManyWithRelations({
      collection: 'articles',
      query: { expand: 'author_id' },
      options: { schema, database: {} },
      ItemsServiceClass: RestrictedItemsService,
    }),
    (error) => error.code === 'INVALID_QUERY' && error.path === 'expand.author_id',
  );
});
