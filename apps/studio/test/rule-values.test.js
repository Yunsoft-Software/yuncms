import assert from 'node:assert/strict';
import test from 'node:test';
import { DYNAMIC_VALUES, normalizeRuleValue } from '../src/rule-values.js';

test('visual permission rules preserve exact decimal strings across the signed MySQL BIGINT range', () => {
  for (const value of ['9007199254740993', '9223372036854775807', '-9223372036854775808', '0']) {
    assert.equal(normalizeRuleValue('bigint', '_eq', value), value);
  }
});

test('visual rule normalization preserves dynamic values, scalar types, null predicates and invalid input', () => {
  for (const type of ['bigint', 'integer', 'decimal', 'boolean', 'date']) for (const value of DYNAMIC_VALUES) assert.equal(normalizeRuleValue(type, '_eq', value), value);
  assert.equal(normalizeRuleValue('integer', '_eq', '42'), 42);
  assert.equal(normalizeRuleValue('decimal', '_eq', '1234.56'), 1234.56);
  assert.equal(normalizeRuleValue('integer', '_eq', 'invalid'), 'invalid');
  assert.equal(normalizeRuleValue('decimal', '_eq', 'invalid'), 'invalid');
  assert.equal(normalizeRuleValue('boolean', '_eq', 'true'), true);
  assert.equal(normalizeRuleValue('boolean', '_eq', 'false'), false);
  assert.equal(normalizeRuleValue('text', '_eq', 'Türkçe العربية'), 'Türkçe العربية');
  assert.equal(normalizeRuleValue('bigint', '_null', ''), true);
  assert.equal(normalizeRuleValue('bigint', '_nnull', ''), true);
});
