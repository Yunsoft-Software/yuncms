import assert from 'node:assert/strict';
import test from 'node:test';

import { parseExpandInput, readManyWithRelations } from '../src/relation-expansion.js';

const schema = {
  collections: {
    articles: {
      collection: 'articles',
      primary_key: 'id',
      fields: {
        id: { field: 'id', type: 'uuid' },
        title: { field: 'title', type: 'string' },
        author_id: { field: 'author_id', type: 'uuid' },
      },
    },
    authors: {
      collection: 'authors',
      primary_key: 'id',
      fields: {
        id: { field: 'id', type: 'uuid' },
        name: { field: 'name', type: 'string' },
        bio: { field: 'bio', type: 'text' },
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

function createHarness({ sourcePermission = { fields: null } } = {}) {
  const calls = [];

  class FakeItemsService {
    constructor(collection) {
      this.collection = collection;
    }

    async resolvePermission() {
      return this.collection === 'articles' ? sourcePermission : { fields: null };
    }

    async readManyWithMeta(query) {
      calls.push({ collection: this.collection, method: 'readManyWithMeta', query });
      return {
        data: [{ id: 'article-1', title: 'Hello', author_id: 'author-1' }],
        meta: { total_count: 1, limit: 100, offset: 0 },
      };
    }

    async readMany(query) {
      calls.push({ collection: this.collection, method: 'readMany', query });
      return [{ id: 'author-1', name: 'Ada', bio: 'Writer' }];
    }
  }

  return { FakeItemsService, calls };
}

test('fields=* selects all readable source fields without relation expansion', async () => {
  const { FakeItemsService, calls } = createHarness();
  const result = await readManyWithRelations({
    collection: 'articles',
    query: { fields: '*' },
    options: { schema, database: {} },
    ItemsServiceClass: FakeItemsService,
  });

  assert.deepEqual(calls[0].query.fields, ['*']);
  assert.equal(calls.some((call) => call.collection === 'authors'), false);
  assert.equal(result.data[0].author_id, 'author-1');
});

test('fields=*.* expands every readable direct relation one level', async () => {
  const { FakeItemsService, calls } = createHarness();
  const result = await readManyWithRelations({
    collection: 'articles',
    query: { fields: '*.*' },
    options: { schema, database: {} },
    ItemsServiceClass: FakeItemsService,
  });

  assert.deepEqual(calls[0].query.fields, ['*']);
  const targetCall = calls.find((call) => call.collection === 'authors');
  assert.deepEqual(targetCall.query.fields, ['*']);
  assert.deepEqual(targetCall.query.filter, { id: { _in: ['author-1'] } });
  assert.deepEqual(result.data[0].author_id, {
    id: 'author-1',
    name: 'Ada',
    bio: 'Writer',
  });
});

test('relation.field selects only the requested nested relation fields', async () => {
  const { FakeItemsService, calls } = createHarness();
  const result = await readManyWithRelations({
    collection: 'articles',
    query: { fields: 'id,author_id.name' },
    options: { schema, database: {} },
    ItemsServiceClass: FakeItemsService,
  });

  assert.deepEqual(calls[0].query.fields, ['id', 'author_id']);
  const targetCall = calls.find((call) => call.collection === 'authors');
  assert.deepEqual(targetCall.query.fields, ['name', 'id']);
  assert.deepEqual(result.data[0].author_id, { name: 'Ada' });
});

test('relation.* expands a selected direct relation with all readable target fields', async () => {
  const { FakeItemsService, calls } = createHarness();
  const result = await readManyWithRelations({
    collection: 'articles',
    query: { fields: 'id,author_id.*' },
    options: { schema, database: {} },
    ItemsServiceClass: FakeItemsService,
  });

  assert.deepEqual(calls[0].query.fields, ['id', 'author_id']);
  assert.deepEqual(calls.find((call) => call.collection === 'authors').query.fields, ['*']);
  assert.equal(result.data[0].author_id.name, 'Ada');
});

test('legacy expand remains supported without an arbitrary relation-count cap', async () => {
  assert.doesNotThrow(() => parseExpandInput('a,b,c,d,e,f,g,h,i,j'));

  const { FakeItemsService, calls } = createHarness();
  const result = await readManyWithRelations({
    collection: 'articles',
    query: { fields: 'id', expand: 'author_id' },
    options: { schema, database: {} },
    ItemsServiceClass: FakeItemsService,
  });

  assert.deepEqual(calls[0].query.fields, ['id', 'author_id']);
  assert.deepEqual(calls.find((call) => call.collection === 'authors').query.fields, ['*']);
  assert.equal(result.data[0].author_id.name, 'Ada');
});

test('source field allowlist is checked before explicit nested expansion', async () => {
  const { FakeItemsService } = createHarness({ sourcePermission: { fields: ['id', 'title'] } });

  await assert.rejects(
    readManyWithRelations({
      collection: 'articles',
      query: { fields: 'id,author_id.name' },
      options: { schema, database: {} },
      ItemsServiceClass: FakeItemsService,
    }),
    (error) => error.code === 'INVALID_QUERY' && error.path === 'fields.author_id.name',
  );
});

test('wildcard nested expansion silently omits unreadable source relations', async () => {
  const { FakeItemsService, calls } = createHarness({ sourcePermission: { fields: ['id', 'title'] } });
  await readManyWithRelations({
    collection: 'articles',
    query: { fields: '*.*' },
    options: { schema, database: {} },
    ItemsServiceClass: FakeItemsService,
  });

  assert.equal(calls.some((call) => call.collection === 'authors'), false);
});

test('fields rejects relation depth deeper than one level for the current direct relation engine', async () => {
  const { FakeItemsService } = createHarness();
  await assert.rejects(
    readManyWithRelations({
      collection: 'articles',
      query: { fields: 'author_id.profile.name' },
      options: { schema, database: {} },
      ItemsServiceClass: FakeItemsService,
    }),
    (error) => error.code === 'UNSUPPORTED_RELATION_EXPANSION',
  );
});
