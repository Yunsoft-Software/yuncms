import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';

const SRC = resolve(import.meta.dirname, '../src');
const filesSource = readFileSync(resolve(SRC, 'screens/FilesScreen.jsx'), 'utf8');
const railSource = readFileSync(resolve(SRC, 'components/FileCategoryRail.jsx'), 'utf8');
const railCss = readFileSync(resolve(SRC, 'file-category-rail.css'), 'utf8');
const componentIndex = readFileSync(resolve(SRC, 'components/index.js'), 'utf8');

test('Files exposes category navigation through the shared component entry point', () => {
  assert.match(componentIndex, /FileCategoryRail/);
  assert.match(filesSource, /FileCategoryRail,/);
  assert.match(filesSource, /<FileCategoryRail/);
  assert.match(railSource, /aria-current/);
});

test('Files recent category is explicitly a seven day filter', () => {
  assert.match(filesSource, /RECENT_WINDOW_MS = 7 \* 24 \* 60 \* 60 \* 1000/);
  assert.match(filesSource, /function isRecentFile/);
  assert.match(filesSource, /typeFilter === 'recent'/);
  assert.match(filesSource, /counts\.recent \+= 1/);
});

test('file categories use a desktop rail and retain a mobile fallback selector', () => {
  assert.match(railCss, /grid-template-columns: 176px minmax\(0, 1fr\)/);
  assert.match(railCss, /position: sticky/);
  assert.match(railCss, /@media \(max-width: 760px\)/);
  assert.match(filesSource, /file-type-fallback/);
});
