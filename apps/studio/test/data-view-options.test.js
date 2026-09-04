import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';

const SRC = resolve(import.meta.dirname, '../src');
const contentSource = readFileSync(resolve(SRC, 'screens/ContentScreen.jsx'), 'utf8');
const optionsSource = readFileSync(resolve(SRC, 'components/DataViewOptions.jsx'), 'utf8');
const optionsCss = readFileSync(resolve(SRC, 'data-view-options.css'), 'utf8');

test('Content exposes column visibility through the shared view options component', () => {
  assert.match(contentSource, /DataViewOptions/);
  assert.match(contentSource, /visibleColumnKeys/);
  assert.match(contentSource, /visibleTableFields/);
  assert.match(contentSource, /defaultContentColumnKeys\(tableFields\)/);
  assert.match(contentSource, /toggleVisibleColumn/);
  assert.match(optionsSource, /onToggleColumn/);
  assert.match(optionsSource, /disabled=\{onlyVisible\}/);
});

test('Content density changes presentation without changing the item query', () => {
  assert.match(contentSource, /density, setDensity/);
  assert.match(contentSource, /content-table-density-\$\{density\}/);
  assert.match(optionsSource, /\['compact'/);
  assert.match(optionsSource, /\['comfortable'/);
  assert.match(optionsSource, /\['relaxed'/);
  assert.match(optionsCss, /\.content-table-density-compact td/);
  assert.match(optionsCss, /\.content-table-density-relaxed td/);
  assert.doesNotMatch(optionsSource, /apiRequest|fetch\(/);
});
