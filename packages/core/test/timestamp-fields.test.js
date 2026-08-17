import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';

import { compileFieldColumn } from '../src/field-types.js';

const fieldsServiceSource = readFileSync(
  resolve(import.meta.dirname, '../src/services/fields-service.js'),
  'utf8',
);

test('timestamp fields support current-time default and automatic update', () => {
  const compiled = compileFieldColumn({
    type: 'timestamp',
    required: true,
    defaultPreset: 'now',
    autoUpdate: true,
  });

  assert.equal(
    compiled.sql,
    'TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3)',
  );
  assert.equal(compiled.params.length, 0);
  assert.equal(compiled.schemaMetadata.defaultPreset, 'now');
  assert.equal(compiled.schemaMetadata.autoUpdate, true);
});

test('datetime supports a current-time default without automatic update', () => {
  const compiled = compileFieldColumn({ type: 'datetime', defaultPreset: 'now' });
  assert.equal(compiled.sql, 'DATETIME(3) NULL DEFAULT CURRENT_TIMESTAMP(3)');
  assert.equal(compiled.schemaMetadata.defaultPreset, 'now');
});

test('current-time automation is rejected for incompatible types', () => {
  assert.throws(
    () => compileFieldColumn({ type: 'string', defaultPreset: 'now' }),
    (error) => error.code === 'UNSUPPORTED_FIELD_DEFAULT',
  );
  assert.throws(
    () => compileFieldColumn({ type: 'date', autoUpdate: true }),
    (error) => error.code === 'UNSUPPORTED_FIELD_DEFAULT',
  );
  assert.throws(
    () => compileFieldColumn({ type: 'timestamp', defaultValue: 'x', defaultPreset: 'now' }),
    (error) => error.code === 'INVALID_FIELD_DEFAULT',
  );
});

test('physical field edits preserve timestamp presets and protect system-managed fields', () => {
  assert.match(fieldsServiceSource, /schemaMetadata\.defaultPreset/);
  assert.match(fieldsServiceSource, /schemaMetadata\.autoUpdate === true/);
  assert.match(fieldsServiceSource, /function assertFieldNotSystemManaged/);
  assert.match(fieldsServiceSource, /removeDefaultPreset/);
});
