import assert from 'node:assert/strict';
import test from 'node:test';
import { compatibleFieldRecovery, fieldRecoverySignature } from '../src/field-recovery.js';

const expected = { column: { type: 'text', collation: 'utf8mb4_0900_ai_ci', nullable: true, default: null, extra: '', comment: '' }, indexes: [] };
const physical = { ...expected, foreignKeys: [], checkConstraints: [] };
test('recovery requires the complete server-normalized physical shape without extra constraints', () => {
  assert.equal(compatibleFieldRecovery(physical, expected), true);
  for (const patch of [{ column: null }, { column: { ...expected.column, nullable: false } },
    { column: { ...expected.column, default: 'unexpected' } }, { column: { ...expected.column, collation: 'utf8mb4_bin' } },
    { indexes: [{ name: 'foreign_index' }] }, { foreignKeys: [{ name: 'fk' }] }, { checkConstraints: [{ name: 'check' }] }]) {
    assert.equal(compatibleFieldRecovery({ ...physical, ...patch }, expected), false);
  }
});
test('recovery confirmation binds the field, exact definition, schema version and physical constraints', () => {
  const input = { collection: 'messages', field: 'content', definition: { field: 'content', type: 'text', options: { a: 1, b: 2 } }, physical, schemaVersion: 12 };
  const signature = fieldRecoverySignature(input);
  assert.match(signature, /^[a-f0-9]{64}$/);
  assert.equal(fieldRecoverySignature({ ...input, definition: { type: 'text', field: 'content', options: { b: 2, a: 1 } } }), signature);
  for (const patch of [{ collection: 'another' }, { field: 'another' }, { schemaVersion: 13 }, { definition: { ...input.definition, hidden: true } }, { physical: { ...physical, indexes: [{ name: 'new_index' }] } }]) {
    assert.notEqual(fieldRecoverySignature({ ...input, ...patch }), signature);
  }
});
