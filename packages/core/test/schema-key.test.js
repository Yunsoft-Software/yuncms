import assert from 'node:assert/strict';
import test from 'node:test';

import {
  normalizeDisplayName,
  normalizeSchemaKey,
  resolveSchemaName,
} from '../src/schema-key.js';

test('Turkish and spaced display names normalize to stable ASCII schema keys', () => {
  assert.equal(normalizeSchemaKey('Müşteri Talepleri', { prefix: 'collection' }), 'musteri_talepleri');
  assert.equal(normalizeSchemaKey('Ürün Fiyatı'), 'urun_fiyati');
  assert.equal(normalizeSchemaKey('İçecek Ölçüsü'), 'icecek_olcusu');
  assert.equal(normalizeSchemaKey('Çalışma Şekli / Gün'), 'calisma_sekli_gun');
});

test('display names preserve readable Unicode while collapsing whitespace', () => {
  assert.equal(normalizeDisplayName('  Müşteri   Talepleri  '), 'Müşteri Talepleri');
});

test('numeric keys receive a safe semantic prefix', () => {
  assert.equal(normalizeSchemaKey('2026 Ürünleri', { prefix: 'collection' }), 'collection_2026_urunleri');
  assert.equal(normalizeSchemaKey('1. fiyat', { prefix: 'field' }), 'field_1_fiyat');
});

test('resolved schema names keep human label and machine key separate', () => {
  assert.deepEqual(resolveSchemaName({ displayName: 'Satış Siparişleri', prefix: 'collection' }), {
    name: 'Satış Siparişleri',
    key: 'satis_siparisleri',
  });
  assert.deepEqual(resolveSchemaName({ displayName: 'Satış Siparişleri', key: 'orders', prefix: 'collection' }), {
    name: 'Satış Siparişleri',
    key: 'orders',
  });
});

test('names that cannot produce a meaningful key fail closed', () => {
  assert.throws(() => normalizeSchemaKey('---'), (error) => error.code === 'INVALID_SCHEMA_NAME');
});
