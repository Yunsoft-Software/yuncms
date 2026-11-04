import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { inputValueForField, outputValueForField } from '../src/content-field-values.js';
import { buildInitialNestedDraft } from '../src/content-relations.js';

test('new record defaults preserve draft, boolean true, false, zero and empty string', () => {
  for (const [type, value, expected] of [['string', 'draft', 'draft'], ['boolean', true, true], ['boolean', false, false], ['integer', 0, '0'], ['string', '', '']]) {
    for (const metadata of [{ defaultValue: value }, JSON.stringify({ defaultValue: value })]) {
      const field = { type, required: true, interface: 'select-dropdown', schema_metadata: metadata };
      assert.equal(inputValueForField(field, undefined), expected);
      assert.equal(outputValueForField(field, expected), value);
    }
  }
});

test('required selects never infer a default from option order and stored values override defaults', () => {
  const field = { type: 'string', field: 'status', required: true, interface: 'select-dropdown', options: { choices: ['published', 'draft'] } };
  assert.equal(inputValueForField(field, undefined), '');
  assert.equal(inputValueForField({ ...field, schema_metadata: { defaultValue: 'draft' } }, 'archived'), 'archived');
  assert.equal(inputValueForField({ ...field, schema_metadata: { defaultValue: 'draft' } }, null), '');
  assert.equal(inputValueForField({ ...field, schema_metadata: '{invalid' }, undefined), '');
  assert.equal(inputValueForField({ type: 'boolean' }, '0'), false);
});

test('nested forms share typed defaults and preserve existing values', () => {
  const rel = { key: 'children', kind: 'o2m', primaryKey: 'id', editableFields: [{ field: 'enabled', type: 'boolean', schema_metadata: { defaultValue: true } }] };
  const draft = buildInitialNestedDraft([rel], { children: [{ id: 1 }, { id: 2, enabled: false }] });
  assert.equal(draft.children[0].values.enabled, true);
  assert.equal(draft.children[1].values.enabled, false);
});

test('BIGINT serialization preserves exact decimal strings across the entire signed MySQL range', () => {
  const field = { type: 'bigint', required: true };
  for (const value of ['0', '-1', '9007199254740993', '9223372036854775807', '-9223372036854775808']) {
    assert.equal(outputValueForField(field, inputValueForField(field, value)), value);
  }
  assert.equal(outputValueForField({ type: 'bigint' }, ''), null);
  const source = readFileSync(new URL('../src/screens/ContentScreen.jsx', import.meta.url), 'utf8');
  assert.match(source, /return outputValueForField\(\{ \.\.\.field, required: true \}, value\)/);
  const users = readFileSync(new URL('../src/screens/UsersScreen.jsx', import.meta.url), 'utf8');
  assert.match(users, /outputValueForField\(field, rawValue\)/);
});

test('record and nested select controls expose an explicit empty choice', () => {
  for (const name of ['screens/ContentScreen.jsx', 'components/NestedRelationsEditor.jsx']) {
    const source = readFileSync(new URL(`../src/${name}`, import.meta.url), 'utf8');
    assert.match(source, /<option value="">\{(?:field\.)?required \? t\('content.select'\) : t\('common.none'\)\}<\/option>/);
  }
});
