import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';

import { fieldLabel } from '../src/screens/ContentScreen.jsx';

const source = readFileSync(resolve(import.meta.dirname, '../src/screens/ContentScreen.jsx'), 'utf8');

test('Content prefers human field labels while keeping field keys for API operations', () => {
  assert.equal(fieldLabel({ name: 'Ürün Fiyatı', field: 'urun_fiyati' }), 'Ürün Fiyatı');
  assert.equal(fieldLabel({ field: 'urun_fiyati' }), 'urun_fiyati');
  assert.match(source, /value=\{field\.field\}>\{fieldLabel\(field\)\}<\/option>/);
  assert.match(source, /toggleColumnSort\(field\.field\)/);
  assert.match(source, /<span>\{fieldLabel\(field\)\}<\/span>/);
});

test('record forms display the human label and keep machine key secondary', () => {
  assert.match(source, /const label = fieldLabel\(field\)/);
  assert.match(source, /field-api-key/);
  assert.match(source, /\[field\.field\]:/);
});
