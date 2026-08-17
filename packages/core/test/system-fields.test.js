import assert from 'node:assert/strict';
import test from 'node:test';

import {
  compileCollectionSystemFields,
  normalizeCollectionSystemFields,
  systemMutationEntries,
} from '../src/system-fields.js';

test('collection system fields normalize to the supported stable order', () => {
  assert.deepEqual(
    normalizeCollectionSystemFields(['updated_by', 'created_at', 'created_at']),
    ['created_at', 'updated_by'],
  );
  assert.throws(
    () => normalizeCollectionSystemFields(['made_up']),
    (error) => error.code === 'INVALID_SCHEMA_PAYLOAD',
  );
});

test('accountability field compiler creates timestamps and user foreign keys', () => {
  const result = compileCollectionSystemFields('articles', [
    'created_at',
    'updated_at',
    'created_by',
    'updated_by',
  ]);

  assert.deepEqual(result.fields, ['created_at', 'updated_at', 'created_by', 'updated_by']);
  assert.match(result.columns.join('\n'), /`created_at` TIMESTAMP\(3\) NOT NULL DEFAULT CURRENT_TIMESTAMP\(3\)/);
  assert.match(result.columns.join('\n'), /`updated_at` TIMESTAMP\(3\) NOT NULL DEFAULT CURRENT_TIMESTAMP\(3\) ON UPDATE CURRENT_TIMESTAMP\(3\)/);
  assert.match(result.columns.join('\n'), /`created_by` CHAR\(36\) NULL/);
  assert.match(result.constraints.join('\n'), /FOREIGN KEY \(`created_by`\) REFERENCES yuncms_users \(id\) ON DELETE SET NULL/);
  assert.match(result.constraints.join('\n'), /FOREIGN KEY \(`updated_by`\) REFERENCES yuncms_users \(id\) ON DELETE SET NULL/);

  const createdAt = result.metadata.find((field) => field.field === 'created_at');
  const updatedBy = result.metadata.find((field) => field.field === 'updated_by');
  assert.equal(createdAt.readonly, true);
  assert.equal(createdAt.schemaMetadata.special, 'date-created');
  assert.equal(createdAt.schemaMetadata.systemManaged, true);
  assert.equal(updatedBy.interface, 'user');
  assert.equal(updatedBy.schemaMetadata.special, 'user-updated');
});

test('system mutation entries stamp actor and dates for create/update', () => {
  const schema = {
    fields: {
      created_at: { field: 'created_at', schema_metadata: { special: 'date-created' } },
      updated_at: { field: 'updated_at', schema_metadata: JSON.stringify({ special: 'date-updated' }) },
      created_by: { field: 'created_by', schema_metadata: { special: 'user-created' } },
      updated_by: { field: 'updated_by', schema_metadata: { special: 'user-updated' } },
      title: { field: 'title', schema_metadata: null },
    },
  };
  const now = new Date('2026-08-17T06:00:00.000Z');
  const accountability = { user: 'user-1' };

  assert.deepEqual(systemMutationEntries(schema, accountability, 'create', now), [
    ['created_at', now],
    ['updated_at', now],
    ['created_by', 'user-1'],
    ['updated_by', 'user-1'],
  ]);
  assert.deepEqual(systemMutationEntries(schema, accountability, 'update', now), [
    ['updated_at', now],
    ['updated_by', 'user-1'],
  ]);
});
