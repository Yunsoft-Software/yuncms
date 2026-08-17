import assert from 'node:assert/strict';
import test from 'node:test';

import { SchemaMetadataRepository } from '../src/schema-metadata-repository.js';

function createCollectionMetadataDatabase() {
  let row = {
    collection: 'article_tags',
    primary_key: 'id',
    note: 'M2M junction',
    singleton: 0,
    hidden: 1,
    system: 0,
    metadata: JSON.stringify({ junction: true }),
    created_at: null,
    updated_at: null,
  };
  const calls = [];

  return {
    calls,
    async query(sql, params = []) {
      const text = sql.replace(/\s+/g, ' ').trim();
      calls.push({ sql: text, params });
      if (text.startsWith('UPDATE yuncms_collections SET hidden = ?')) {
        row = { ...row, hidden: params[0] };
        return [{ affectedRows: 1 }, []];
      }
      if (text.includes('FROM yuncms_collections') && text.includes('WHERE collection = ?')) {
        return [[{ ...row }], []];
      }
      throw new Error(`unexpected query: ${text}`);
    },
  };
}

test('collection hidden metadata can be toggled without touching schema/data tables', async () => {
  const database = createCollectionMetadataDatabase();
  const repository = new SchemaMetadataRepository(database);

  const shown = await repository.updateCollectionMetadata('article_tags', { hidden: false });
  assert.equal(Number(shown.hidden), 0);
  assert.equal(database.calls.some(({ sql }) => sql.startsWith('ALTER TABLE')), false);
  assert.equal(database.calls.some(({ sql }) => sql.startsWith('DELETE FROM')), false);

  const hidden = await repository.updateCollectionMetadata('article_tags', { hidden: true });
  assert.equal(Number(hidden.hidden), 1);
});
