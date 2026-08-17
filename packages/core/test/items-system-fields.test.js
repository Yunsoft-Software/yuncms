import assert from 'node:assert/strict';
import test from 'node:test';

import { createAccountability } from '../src/accountability.js';
import { ItemsService } from '../src/services/items-service.js';

const schema = {
  version: 7,
  collections: {
    articles: {
      collection: 'articles',
      system: false,
      primary_key: 'id',
      fields: {
        id: { field: 'id', type: 'uuid', required: true, readonly: true, schema_metadata: { primaryKey: true } },
        title: { field: 'title', type: 'string', required: true, readonly: false, schema_metadata: { length: 255 } },
        created_at: { field: 'created_at', type: 'timestamp', required: true, readonly: true, schema_metadata: { special: 'date-created', systemManaged: true, defaultPreset: 'now' } },
        updated_at: { field: 'updated_at', type: 'timestamp', required: true, readonly: true, schema_metadata: { special: 'date-updated', systemManaged: true, defaultPreset: 'now', autoUpdate: true } },
        created_by: { field: 'created_by', type: 'uuid', required: false, readonly: true, schema_metadata: { special: 'user-created', systemManaged: true } },
        updated_by: { field: 'updated_by', type: 'uuid', required: false, readonly: true, schema_metadata: { special: 'user-updated', systemManaged: true } },
      },
    },
  },
};

function adminAccountability() {
  return createAccountability({ user: 'admin-user', role: 'admin-role', admin: true });
}

test('item create injects created/updated dates and actor ids without caller fields', async () => {
  let insert = null;
  const database = {
    async query(sql, params = []) {
      const normalized = sql.replace(/\s+/g, ' ').trim();
      if (normalized.startsWith('INSERT INTO `articles`')) {
        insert = { sql: normalized, params };
        return [{ affectedRows: 1 }, []];
      }
      if (normalized.startsWith('SELECT')) {
        return [[{ id: params.at(-1) || 'generated', title: 'Hello' }], []];
      }
      throw new Error(`Unexpected query: ${normalized}`);
    },
  };
  const service = new ItemsService('articles', {
    database,
    schema,
    accountability: adminAccountability(),
  });

  await service.createOne({ title: 'Hello' });
  assert.ok(insert);
  assert.match(insert.sql, /`created_at`/);
  assert.match(insert.sql, /`updated_at`/);
  assert.match(insert.sql, /`created_by`/);
  assert.match(insert.sql, /`updated_by`/);
  assert.equal(insert.params.includes('admin-user'), true);
  assert.equal(insert.params.filter((value) => value === 'admin-user').length, 2);
  assert.equal(insert.params.filter((value) => value instanceof Date).length, 2);
});

test('item update injects updated date and last actor but not created fields', async () => {
  let update = null;
  const database = {
    async query(sql, params = []) {
      const normalized = sql.replace(/\s+/g, ' ').trim();
      if (normalized.startsWith('UPDATE `articles` SET')) {
        update = { sql: normalized, params };
        return [{ affectedRows: 1 }, []];
      }
      if (normalized.startsWith('SELECT')) {
        return [[{ id: 'article-1', title: 'Changed' }], []];
      }
      throw new Error(`Unexpected query: ${normalized}`);
    },
  };
  const service = new ItemsService('articles', {
    database,
    schema,
    accountability: adminAccountability(),
  });

  await service.updateOne('article-1', { title: 'Changed' });
  assert.ok(update);
  assert.match(update.sql, /`updated_at` = \?/);
  assert.match(update.sql, /`updated_by` = \?/);
  assert.doesNotMatch(update.sql, /`created_at` = \?/);
  assert.doesNotMatch(update.sql, /`created_by` = \?/);
  assert.equal(update.params.includes('admin-user'), true);
  assert.equal(update.params.some((value) => value instanceof Date), true);
});
