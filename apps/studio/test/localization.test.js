import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';
import test from 'node:test';

import { FIELD_TYPE_OPTIONS } from '../src/field-ui.js';
import {
  LOCALE_CATALOG,
  SUPPORTED_LOCALES,
  getEnabledLocaleDefinitions,
  getLocaleDefinition,
  isSupportedLocale,
} from '../src/locale-registry.js';
import {
  DICTIONARIES,
  EN,
  ES,
  TR,
  hasTranslation,
  translate,
} from '../src/localization.js';

const SRC_ROOT = resolve(import.meta.dirname, '../src');

function sourceFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return ['.js', '.jsx'].includes(extname(entry.name)) ? [path] : [];
  });
}

function staticTranslationKeys() {
  const keys = new Set();
  const pattern = /\bt\(\s*['"]([^'"]+)['"]/g;
  for (const file of sourceFiles(SRC_ROOT)) {
    const source = readFileSync(file, 'utf8');
    for (const match of source.matchAll(pattern)) keys.add(match[1]);
  }
  return [...keys].sort();
}

function placeholders(message) {
  return [...String(message).matchAll(/\{(\w+)\}/g)]
    .map((match) => match[1])
    .sort();
}

test('locale registry exposes enabled locales as the single supported locale list', () => {
  assert.deepEqual(SUPPORTED_LOCALES, ['en', 'tr', 'es']);
  assert.equal(isSupportedLocale('en'), true);
  assert.equal(isSupportedLocale('tr'), true);
  assert.equal(isSupportedLocale('es'), true);
  assert.equal(isSupportedLocale('de'), false);
  assert.equal(getLocaleDefinition('tr').nativeName, 'Türkçe');
  assert.equal(getLocaleDefinition('es').nativeName, 'Español');
  assert.equal(getLocaleDefinition('unknown').code, 'en');
  assert.deepEqual(
    getEnabledLocaleDefinitions().map((locale) => locale.code),
    SUPPORTED_LOCALES,
  );
  assert.equal(LOCALE_CATALOG.ar.direction, 'rtl');
});

test('all enabled dictionaries have identical key coverage with English', () => {
  const englishKeys = Object.keys(EN).sort();
  for (const locale of SUPPORTED_LOCALES) {
    assert.ok(DICTIONARIES[locale], `Missing dictionary export for enabled locale ${locale}`);
    assert.deepEqual(Object.keys(DICTIONARIES[locale]).sort(), englishKeys, locale);
  }
});

test('enabled translations preserve English interpolation placeholders', () => {
  for (const locale of SUPPORTED_LOCALES) {
    for (const [key, englishMessage] of Object.entries(EN)) {
      assert.deepEqual(
        placeholders(DICTIONARIES[locale][key]),
        placeholders(englishMessage),
        `${locale}:${key}`,
      );
    }
  }
});

test('every statically referenced Studio translation exists in every enabled locale', () => {
  const missing = [];
  for (const key of staticTranslationKeys()) {
    for (const locale of SUPPORTED_LOCALES) {
      if (!hasTranslation(locale, key)) missing.push(`${locale}:${key}`);
    }
  }
  assert.deepEqual(missing, []);
});

test('dynamic field, permission and Data Model tab labels are translated in every enabled locale', () => {
  const dynamicKeys = [
    ...FIELD_TYPE_OPTIONS.map((option) => option.labelKey),
    ...['read', 'create', 'update', 'delete'].map((action) => `roles.${action}`),
    ...['overview', 'fields', 'relations'].map((tab) => `dataModel.tab.${tab}`),
  ];
  const missing = [];
  for (const key of dynamicKeys) {
    for (const locale of SUPPORTED_LOCALES) {
      if (!hasTranslation(locale, key)) missing.push(`${locale}:${key}`);
    }
  }
  assert.deepEqual(missing, []);
});

test('translations interpolate values and fall back safely for an unknown locale', () => {
  assert.equal(translate('en', 'users.summary', { total: 12, active: 8 }), '12 total · 8 active');
  assert.equal(translate('tr', 'users.summary', { total: 12, active: 8 }), 'Toplam 12 · 8 aktif');
  assert.equal(translate('es', 'users.summary', { total: 12, active: 8 }), '12 en total · 8 activos');
  assert.equal(translate('de', 'common.save'), 'Save');
});

test('Turkish and Spanish locales contain real localized Studio copy', () => {
  assert.equal(TR['nav.settings'], 'Ayarlar');
  assert.equal(TR['content.deleteRecordAction'], 'Kaydı sil');
  assert.equal(TR['appearance.logoFromFiles'], 'Dosyalardan logo seç');
  assert.equal(TR['fieldType.image'], 'Görsel');
  assert.equal(TR['dataModel.oneToOne'], 'Bire bir');
  assert.equal(TR['dataModel.tab.overview'], 'Genel');

  assert.equal(ES['nav.settings'], 'Ajustes');
  assert.equal(ES['content.deleteRecordAction'], 'Eliminar registro');
  assert.equal(ES['appearance.logoFromFiles'], 'Logotipo desde Archivos');
  assert.equal(ES['fieldType.image'], 'Imagen');
  assert.equal(ES['dataModel.oneToOne'], 'Uno a uno');
  assert.equal(ES['dataModel.tab.overview'], 'Resumen');
});
