import assert from 'node:assert/strict';
import test from 'node:test';

import { readManyWithRelations, readOneWithRelations } from '../src/relation-expansion.js';

const collections = {
  articles: { primary_key: 'id', fields: { id: { field: 'id' }, author: { field: 'author' }, title: { field: 'title' } } },
  authors: { primary_key: 'id', fields: { id: { field: 'id' }, company: { field: 'company' }, name: { field: 'name' } } },
  companies: { primary_key: 'id', fields: { id: { field: 'id' }, name: { field: 'name' } } },
};
const relations = new Map([
  ['articles.author', { many_collection: 'articles', many_field: 'author', one_collection: 'authors', one_field: 'id', metadata: { kind: 'm2o' } }],
  ['authors.company', { many_collection: 'authors', many_field: 'company', one_collection: 'companies', one_field: 'id', metadata: { kind: 'm2o' } }],
]);
const schema = { collections, relationByManyField: relations };
const data = {
  articles: [{ id: 'a1', author: 'u1', title: 'Post' }],
  authors: [{ id: 'u1', company: 'c1', name: 'Ada' }],
  companies: [{ id: 'c1', name: 'Acme' }],
};

function project(collection, row, fields) {
  const selected = !fields || fields.includes('*') ? Object.keys(collections[collection].fields) : fields;
  return Object.fromEntries(selected.filter((field) => Object.hasOwn(row, field)).map((field) => [field, row[field]]));
}

class FakeItemsService {
  constructor(collection) { this.collection = collection; }
  async resolvePermission() { return { fields: null }; }
  async readManyWithMeta(query = {}) {
    return { data: data[this.collection].map((row) => project(this.collection, row, query.fields)), meta: {} };
  }
  async readOne(id, { fields = null } = {}) {
    const row = data[this.collection].find((item) => item.id === id);
    return row ? project(this.collection, row, fields) : null;
  }
  async readManyForRelation({ fields, lookupField, values }) {
    return {
      data: data[this.collection]
        .filter((row) => values.includes(String(row[lookupField])))
        .map((row) => ({ ...project(this.collection, row, fields), [lookupField]: row[lookupField] })),
      visibleFields: Object.keys(collections[this.collection].fields),
    };
  }
}

test('fields paths expand direct relations recursively in batches', async () => {
  const result = await readManyWithRelations({
    collection: 'articles',
    query: { fields: 'title,author.name,author.company.name', limit: 1 },
    options: { schema },
    ItemsServiceClass: FakeItemsService,
  });
  assert.deepEqual(result.data, [{
    title: 'Post',
    author: { name: 'Ada', company: { name: 'Acme' } },
  }]);
});

test('readOne without fields preserves ordinary full-record behavior', async () => {
  const result = await readOneWithRelations({
    collection: 'articles',
    id: 'a1',
    options: { schema },
    ItemsServiceClass: FakeItemsService,
  });
  assert.deepEqual(result, { id: 'a1', author: 'u1', title: 'Post' });
});

test('cyclic paths fail before data execution', async () => {
  const cyclicSchema = {
    collections: {
      nodes: { primary_key: 'id', fields: { id: { field: 'id' }, parent: { field: 'parent' } } },
    },
    relationByManyField: new Map([
      ['nodes.parent', { many_collection: 'nodes', many_field: 'parent', one_collection: 'nodes', one_field: 'id', metadata: { kind: 'm2o' } }],
    ]),
  };
  class NodeService extends FakeItemsService {
    constructor() { super('nodes'); }
    async readManyWithMeta() { return { data: [], meta: {} }; }
  }
  await assert.rejects(() => readManyWithRelations({
    collection: 'nodes', query: { fields: 'parent.parent.id' }, options: { schema: cyclicSchema }, ItemsServiceClass: NodeService,
  }), /Cyclic relation path/);
});
