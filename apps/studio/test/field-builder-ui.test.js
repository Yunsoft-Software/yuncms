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
const dataModelSource = readFileSync(resolve(SRC, 'screens/DataModelV2Screen.jsx'), 'utf8');
const dataModelEntrySource = readFileSync(resolve(SRC, 'screens/DataModelScreen.jsx'), 'utf8');

test('field type browser separates common, media and advanced choices', () => {
  assert.deepEqual(FIELD_TYPE_GROUPS.map((group) => group.key), ['common', 'media', 'advanced']);
  const types = FIELD_TYPE_GROUPS.flatMap((group) => group.options.map((option) => option.value));
  for (const expected of ['string', 'text', 'integer', 'decimal', 'boolean', 'date', 'datetime', 'timestamp', 'file', 'image', 'bigint', 'json', 'uuid']) {
    assert.equal(types.includes(expected), true, `${expected} should be selectable`);
  }
});

test('field creation payload keeps the label and supports timestamp current-time automation', () => {
  const form = {
    ...createEmptyFieldForm(),
    name: 'Son Görülme Zamanı',
    field: 'son_gorulme_zamani',
    type: 'timestamp',
    required: true,
    defaultMode: 'now',
    autoUpdate: true,
  };
  assert.deepEqual(fieldCreationPayload(form), {
    name: 'Son Görülme Zamanı',
    field: 'son_gorulme_zamani',
    type: 'timestamp',
    required: true,
    defaultPreset: 'now',
    autoUpdate: true,
  });
});

test('fixed date-time defaults are normalized from browser input to MySQL format', () => {
  const payload = fieldCreationPayload({
    ...createEmptyFieldForm(),
    name: 'Published at',
    field: 'published_at',
    type: 'datetime',
    defaultMode: 'value',
    defaultValue: '2026-08-17T10:30',
  });
  assert.equal(payload.defaultValue, '2026-08-17 10:30:00');
});

test('decimal field builder sends explicit precision and scale', () => {
  const payload = fieldCreationPayload({
    ...createEmptyFieldForm(),
    name: 'Ürün Fiyatı',
    field: 'urun_fiyati',
    type: 'decimal',
    precision: 12,
    scale: 4,
  });
  assert.equal(payload.name, 'Ürün Fiyatı');
  assert.equal(payload.field, 'urun_fiyati');
  assert.equal(payload.precision, 12);
  assert.equal(payload.scale, 4);
});

test('field builder accepts a natural display name and maintains a separate generated API key', () => {
  assert.match(builderSource, /fieldBuilder\.displayName/);
  assert.match(builderSource, /fieldBuilder\.apiKey/);
  assert.match(builderSource, /schemaKeyFromName\(value, 'field'\)/);
  assert.match(builderSource, /keyTouched/);
});

test('Data Model V2 uses the dedicated visual builder and defaults accountability fields on new collections', () => {
  assert.match(dataModelEntrySource, /DataModelV2Screen as DataModelScreen/);
  assert.match(dataModelSource, /<FieldBuilder/);
  assert.match(dataModelSource, /systemFields: ACCOUNTABILITY_FIELDS\.map/);
  assert.match(dataModelSource, /systemFields: collectionForm\.systemFields/);
  assert.match(dataModelSource, /system-collections\/\$\{encodeURIComponent\(selected\)\}\/fields/);
  for (const field of ['created_at', 'updated_at', 'created_by', 'updated_by']) {
    assert.match(dataModelSource, new RegExp(field));
  }
  assert.match(builderSource, /field-type-card/);
  assert.match(builderSource, /fieldBuilder\.currentTime/);
  assert.match(builderSource, /fieldBuilder\.autoUpdate/);
});
