import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';

import { displaySchemaName } from '../src/schema-name.js';

const source = readFileSync(resolve(import.meta.dirname, '../src/screens/ContentScreen.jsx'), 'utf8');

test('Content prefers human field labels while keeping field keys for API operations', () => {
  assert.equal(displaySchemaName({ name: 'Ürün Fiyatı', field: 'urun_fiyati' }, 'field'), 'Ürün Fiyatı');
  assert.equal(displaySchemaName({ field: 'urun_fiyati' }, 'field'), 'urun_fiyati');
  assert.match(source, /value=\{field\.field\}>\{fieldLabel\(field\)\}<\/option>/);
  assert.match(source, /toggleColumnSort\(field\.field\)/);
  assert.match(source, /<span>\{fieldLabel\(field\)\}<\/span>/);
});

test('record forms display the human label and keep machine key secondary', () => {
  assert.match(source, /const label = fieldLabel\(field\)/);
  assert.match(source, /field-api-key/);
  assert.match(source, /\[field\.field\]:/);
});
