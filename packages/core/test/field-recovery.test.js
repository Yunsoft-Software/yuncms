import assert from 'node:assert/strict';
import test from 'node:test';
import { compatibleFieldRecovery, fieldRecoverySignature, isNativeJsonValidityCheck } from '../src/field-recovery.js';

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
test('only the exact MariaDB JSON validity constraint of the same field is native', () => {
  const check = { CONSTRAINT_NAME: 'journal', CHECK_CLAUSE: 'json_valid(`journal`)' };
  const expectedJson = { column: { type: 'longtext', collation: 'utf8mb4_bin' } };
  assert.equal(isNativeJsonValidityCheck(check, 'journal', expectedJson, '11.4.2-MariaDB'), true);
  assert.equal(isNativeJsonValidityCheck(check, 'journal', { column: { type: 'json', collation: null } }, '8.4.0'), false);
  assert.equal(isNativeJsonValidityCheck(check, 'journal', expectedJson, '8.4.0'), false);
  assert.equal(isNativeJsonValidityCheck(check, 'other', expectedJson, '11.4.2-MariaDB'), false);
  for (const clause of ['json_valid(`other`)', 'json_valid(`journal`) and json_length(`journal`) > 0', 'json_length(`journal`) > 0']) {
    assert.equal(isNativeJsonValidityCheck({ ...check, CHECK_CLAUSE: clause }, 'journal', expectedJson, '11.4.2-MariaDB'), false);
  }
  assert.equal(isNativeJsonValidityCheck({ ...check, CONSTRAINT_NAME: 'custom' }, 'journal', expectedJson, '11.4.2-MariaDB'), false);
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
