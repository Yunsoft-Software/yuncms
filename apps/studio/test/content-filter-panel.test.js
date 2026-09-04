import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';

const SRC = resolve(import.meta.dirname, '../src');
const contentSource = readFileSync(resolve(SRC, 'screens/ContentScreen.jsx'), 'utf8');
const filterCss = readFileSync(resolve(SRC, 'content-filter-panel.css'), 'utf8');

test('Content filter control remains stateful and accessible', () => {
  assert.match(contentSource, /aria-expanded={mobileFiltersOpen}/);
  assert.match(contentSource, /filter-builder \$\{mobileFiltersOpen \? 'mobile-open' : ''\}/);
  assert.match(contentSource, /onSubmit={addFilter}/);
});

test('Content filters render as a desktop popover and mobile inline panel', () => {
  assert.match(filterCss, /position: absolute/);
  assert.match(filterCss, /\.filter-builder\.mobile-open/);
  assert.match(filterCss, /@media \(max-width: 760px\)/);
  assert.match(filterCss, /position: static/);
});
