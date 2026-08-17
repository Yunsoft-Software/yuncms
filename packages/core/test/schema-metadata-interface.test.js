import assert from 'node:assert/strict';
import test from 'node:test';

import { SchemaMetadataRepository } from '../src/schema-metadata-repository.js';

function databaseForField(type) {
  const calls = [];
  return {
    calls,
    async query(sql, params = []) {
      const normalized = sql.replace(/\s+/g, ' ').trim();
      calls.push({ sql: normalized, params });
      if (normalized.startsWith('SELECT id, collection, field, type')) {
        return [[{
          id: 1,
          collection: 'articles',
          field: 'asset',
          type,
          required: 0,
          readonly: 0,
          hidden: 0,
          sort: null,
          interface: null,
          options: null,
          schema_metadata: null,
        }], []];
      }
      if (normalized.startsWith('UPDATE yuncms_fields')) return [{ affectedRows: 1 }, []];
      throw new Error(`Unexpected query: ${normalized}`);
    },
  };
}

test('metadata repository refuses file/image interface on non-UUID fields', async () => {
  const database = databaseForField('string');
  const repository = new SchemaMetadataRepository(database);

  await assert.rejects(
    repository.updateFieldMetadata('articles', 'asset', { interface: 'image' }),
    (error) => error.code === 'INVALID_FIELD_INTERFACE',
  );
  assert.equal(database.calls.some(({ sql }) => sql.startsWith('UPDATE yuncms_fields')), false);
});

test('metadata repository allows file/image interface on UUID fields', async () => {
  const database = databaseForField('uuid');
  const repository = new SchemaMetadataRepository(database);
  const updated = await repository.updateFieldMetadata('articles', 'asset', { interface: 'file' });

  assert.equal(updated.type, 'uuid');
  assert.equal(database.calls.some(({ sql }) => sql.startsWith('UPDATE yuncms_fields')), true);
});
