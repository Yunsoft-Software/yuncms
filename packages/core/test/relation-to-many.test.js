import assert from 'node:assert/strict';
import test from 'node:test';

import {
  relationDescriptorsForCollection,
  readManyWithRelations,
} from '../src/relation-expansion.js';

const relations = [
  {
    id: 1,
    many_collection: 'comments',
    many_field: 'article_id',
    one_collection: 'articles',
    one_field: 'id',
    junction_collection: null,
    junction_field: null,
    metadata: JSON.stringify({ kind: 'm2o' }),
  },
  {
    id: 2,
    many_collection: 'article_tags',
    many_field: 'article_id',
    one_collection: 'articles',
    one_field: 'id',
    junction_collection: 'article_tags',
    junction_field: 'tag_id',
    metadata: JSON.stringify({ kind: 'm2m', side: 'left' }),
  },
  {
    id: 3,
    many_collection: 'article_tags',
    many_field: 'tag_id',
    one_collection: 'tags',
    one_field: 'id',
    junction_collection: 'article_tags',
    junction_field: 'article_id',
    metadata: JSON.stringify({ kind: 'm2m', side: 'right' }),
  },
];

const schema = {
  collections: {
    articles: {
      collection: 'articles',
      primary_key: 'id',
      fields: {
        id: { field: 'id', type: 'uuid' },
        title: { field: 'title', type: 'string' },
      },
    },
    comments: {
      collection: 'comments',
      primary_key: 'id',
      fields: {
        id: { field: 'id', type: 'uuid' },
        article_id: { field: 'article_id', type: 'uuid' },
        text: { field: 'text', type: 'string' },
      },
    },
    tags: {
      collection: 'tags',
      primary_key: 'id',
      fields: {
        id: { field: 'id', type: 'uuid' },
        name: { field: 'name', type: 'string' },
      },
    },
    article_tags: {
      collection: 'article_tags',
      primary_key: 'id',
      fields: {
        id: { field: 'id', type: 'uuid' },
        article_id: { field: 'article_id', type: 'uuid' },
        tag_id: { field: 'tag_id', type: 'uuid' },
      },
    },
  },
  relations,
  relationByManyField: new Map(relations.map((relation) => [
    `${relation.many_collection}.${relation.many_field}`,
    relation,
  ])),
};

function createHarness({ denyJunction = false } = {}) {
  const calls = [];
  const database = {
    async query(sql, params) {
      calls.push({ sql, params });
      if (sql.includes('FROM `comments`')) {
        return [[
          { id: 'comment-1', article_id: 'article-1', text: 'First' },
          { id: 'comment-2', article_id: 'article-1', text: 'Second' },
        ]];
      }
      if (sql.includes('FROM `article_tags`')) {
        return [[
          { article_id: 'article-1', tag_id: 'tag-1' },
          { article_id: 'article-1', tag_id: 'tag-2' },
        ]];
      }
      throw new Error(`Unexpected SQL: ${sql}`);
    },
  };

  class FakeItemsService {
    constructor(collection) {
      this.collection = collection;
      this.database = database;
    }

    async getCollectionSchema() {
      return schema.collections[this.collection];
    }

    async resolvePermission() {
      if (denyJunction && this.collection === 'article_tags') {
        const error = new Error('forbidden');
        error.code = 'FORBIDDEN';
        throw error;
      }
      return { fields: null, filter: null };
    }

    async readManyWithMeta(query) {
      calls.push({ collection: this.collection, query });
      return {
        data: [{ id: 'article-1', title: 'Article' }],
        meta: { total_count: 1, limit: 100, offset: 0 },
      };
    }

    async readManyForRelation(query) {
      calls.push({ collection: this.collection, relationQuery: query });
      if (this.collection !== 'tags') throw new Error(`Unexpected relation lookup: ${this.collection}`);
      return {
        data: query.values.map((id) => ({ id, name: id === 'tag-1' ? 'News' : 'Tech' })),
        visibleFields: query.fields.includes('*') ? ['id', 'name'] : query.fields,
      };
    }
  }

  return { FakeItemsService, calls, database };
}

test('reverse O2M gets a stable virtual alias and expands as an array', async () => {
  const descriptors = relationDescriptorsForCollection(schema, 'articles');
  assert.equal(descriptors.get('comments').kind, 'o2m');

  const { FakeItemsService } = createHarness();
  const result = await readManyWithRelations({
    collection: 'articles',
    query: { fields: 'comments.text' },
    options: { schema, database: {} },
    ItemsServiceClass: FakeItemsService,
  });

  assert.deepEqual(result.data, [{
    comments: [
      { text: 'First' },
      { text: 'Second' },
    ],
  }]);
});

test('M2M uses a stable target alias, enforces junction read access and does not expose junction rows', async () => {
  const descriptors = relationDescriptorsForCollection(schema, 'articles');
  assert.equal(descriptors.get('tags').kind, 'm2m');

  const { FakeItemsService } = createHarness();
  const result = await readManyWithRelations({
    collection: 'articles',
    query: { fields: 'id,tags.name' },
    options: { schema, database: {} },
    ItemsServiceClass: FakeItemsService,
  });
  assert.deepEqual(result.data[0], {
    id: 'article-1',
    title: 'Article',
    tags: [{ name: 'News' }, { name: 'Tech' }],
  });
  assert.equal(JSON.stringify(result.data).includes('tag_id'), false);
  assert.equal(JSON.stringify(result.data).includes('article_id'), false);

  const denied = createHarness({ denyJunction: true });
  await assert.rejects(
    readManyWithRelations({
      collection: 'articles',
      query: { fields: 'id,tags.name' },
      options: { schema, database: {} },
      ItemsServiceClass: denied.FakeItemsService,
    }),
    (error) => error.code === 'FORBIDDEN',
  );
});
