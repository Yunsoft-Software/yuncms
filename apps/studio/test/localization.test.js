import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';
import test from 'node:test';

import {
  EN,
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

test('English and Turkish dictionaries have identical key coverage', () => {
  assert.deepEqual(Object.keys(TR).sort(), Object.keys(EN).sort());
});

test('every statically referenced Studio translation exists in English and Turkish', () => {
  const missing = [];
  for (const key of staticTranslationKeys()) {
    for (const locale of ['en', 'tr']) {
      if (!hasTranslation(locale, key)) missing.push(`${locale}:${key}`);
    }
  }
  assert.deepEqual(missing, []);
});

test('translations interpolate values and fall back safely for an unknown locale', () => {
  assert.equal(translate('en', 'users.summary', { total: 12, active: 8 }), '12 total · 8 active');
  assert.equal(translate('tr', 'users.summary', { total: 12, active: 8 }), 'Toplam 12 · 8 aktif');
  assert.equal(translate('de', 'common.save'), 'Save');
});

test('Turkish locale contains real localized navigation and destructive-action copy', () => {
  assert.equal(TR['nav.settings'], 'Ayarlar');
  assert.equal(TR['content.deleteRecordAction'], 'Kaydı sil');
  assert.equal(TR['appearance.logoHint'], 'Özel logo, varsayılan Yunsoft logosunun tamamen yerine geçer.');
});
