import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const mainSource = await readFile(new URL('../src/main.jsx', import.meta.url), 'utf8');
const paginationSource = await readFile(new URL('../src/components/Pagination.jsx', import.meta.url), 'utf8');
const densitySource = await readFile(new URL('../src/content-density.css', import.meta.url), 'utf8');

test('shared pagination exposes compact ranges plus direct first and last page jumps', () => {
  assert.match(paginationSource, /page <= 4/);
  assert.match(paginationSource, /page >= totalPages - 3/);
  assert.match(paginationSource, /'ellipsis-left'/);
  assert.match(paginationSource, /'ellipsis-right'/);
  assert.match(paginationSource, /onClick=\{\(\) => changePage\(1\)\}/);
  assert.match(paginationSource, /onClick=\{\(\) => changePage\(totalPages\)\}/);
  assert.match(paginationSource, /pagination-page-status/);
});

test('content list loads the density layer and keeps filters collapsed until requested', () => {
  assert.match(mainSource, /import '\.\/content-density\.css';/);
  assert.match(densitySource, /\.content-toolbar[\s\S]*padding: 12px 16px/);
  assert.match(densitySource, /\.data-controls-panel \.mobile-filter-toggle[\s\S]*display: inline-flex/);
  assert.match(densitySource, /\.data-controls-panel \.filter-builder \{[\s\S]*display: none/);
  assert.match(densitySource, /\.data-controls-panel \.filter-builder\.mobile-open \{[\s\S]*display: grid/);
  assert.match(densitySource, /\.data-controls-panel \.controls-hint \{[\s\S]*display: none/);
});
