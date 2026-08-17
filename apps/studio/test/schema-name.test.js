import assert from 'node:assert/strict';
import test from 'node:test';

import { displaySchemaName, schemaKeyFromName } from '../src/schema-name.js';

test('Studio suggests stable ASCII keys from natural Turkish names', () => {
  assert.equal(schemaKeyFromName('Müşteri Talepleri', 'collection'), 'musteri_talepleri');
  assert.equal(schemaKeyFromName('Ürün Fiyatı', 'field'), 'urun_fiyati');
  assert.equal(schemaKeyFromName('İçecek Ölçüsü', 'field'), 'icecek_olcusu');
  assert.equal(schemaKeyFromName('2026 Ürünleri', 'collection'), 'collection_2026_urunleri');
});

test('Studio display helper prefers human name but safely falls back to machine key', () => {
  assert.equal(displaySchemaName({ name: 'Müşteri Talepleri', collection: 'musteri_talepleri' }, 'collection'), 'Müşteri Talepleri');
  assert.equal(displaySchemaName({ field: 'urun_fiyati' }, 'field'), 'urun_fiyati');
});
