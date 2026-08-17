import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';

import {
  FIELD_TYPE_GROUPS,
  createEmptyFieldForm,
  fieldCreationPayload,
} from '../src/field-ui.js';

const SRC = resolve(import.meta.dirname, '../src');
const builderSource = readFileSync(resolve(SRC, 'components/FieldBuilder.jsx'), 'utf8');
const dataModelSource = readFileSync(resolve(SRC, 'screens/DataModelScreen.jsx'), 'utf8');

test('field type browser separates common, media and advanced choices', () => {
  assert.deepEqual(FIELD_TYPE_GROUPS.map((group) => group.key), ['common', 'media', 'advanced']);
  const types = FIELD_TYPE_GROUPS.flatMap((group) => group.options.map((option) => option.value));
  for (const expected of ['string', 'text', 'integer', 'decimal', 'boolean', 'date', 'datetime', 'timestamp', 'file', 'image', 'bigint', 'json', 'uuid']) {
    assert.equal(types.includes(expected), true, `${expected} should be selectable`);
  }
});

test('field creation payload supports timestamp current-time and auto-update presets', () => {
  const form = {
    ...createEmptyFieldForm(),
    field: 'last_seen_at',
    type: 'timestamp',
    required: true,
    defaultMode: 'now',
    autoUpdate: true,
  };
  assert.deepEqual(fieldCreationPayload(form), {
    field: 'last_seen_at',
    type: 'timestamp',
    required: true,
    defaultPreset: 'now',
    autoUpdate: true,
  });
});

test('decimal field builder sends explicit precision and scale', () => {
  const payload = fieldCreationPayload({
    ...createEmptyFieldForm(),
    field: 'price',
    type: 'decimal',
    precision: 12,
    scale: 4,
  });
  assert.equal(payload.precision, 12);
  assert.equal(payload.scale, 4);
});

test('Data Model uses the dedicated visual builder and defaults accountability fields on new collections', () => {
  assert.match(dataModelSource, /<FieldBuilder/);
  assert.match(dataModelSource, /systemFields: ACCOUNTABILITY_FIELDS\.map/);
  assert.match(dataModelSource, /systemFields: collectionForm\.systemFields/);
  for (const field of ['created_at', 'updated_at', 'created_by', 'updated_by']) {
    assert.match(dataModelSource, new RegExp(field));
  }
  assert.match(builderSource, /field-type-card/);
  assert.match(builderSource, /fieldBuilder\.currentTime/);
  assert.match(builderSource, /fieldBuilder\.autoUpdate/);
});
