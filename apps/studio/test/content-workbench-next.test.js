import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';

const SRC = resolve(import.meta.dirname, '../src');
const studioCss = readFileSync(resolve(SRC, 'studio.css'), 'utf8');
const contentSource = readFileSync(resolve(SRC, 'screens/ContentScreen.jsx'), 'utf8');
const workbenchCss = readFileSync(resolve(SRC, 'content-workbench-next.css'), 'utf8');
const shellCss = readFileSync(resolve(SRC, 'studio-next.css'), 'utf8');

test('compact Content workbench stylesheet is loaded after the Studio shell foundation', () => {
  const shellIndex = studioCss.indexOf("@import './studio-next.css';");
  const workbenchIndex = studioCss.indexOf("@import './content-workbench-next.css';");
  assert.ok(shellIndex > -1);
  assert.ok(workbenchIndex > shellIndex);
});

test('existing Content filter state drives the compact filter disclosure', () => {
  assert.match(contentSource, /className="secondary-button mobile-filter-toggle"/);
  assert.match(contentSource, /aria-expanded=\{mobileFiltersOpen\}/);
  assert.match(contentSource, /filter-builder \$\{mobileFiltersOpen \? 'mobile-open' : ''\}/);
  assert.match(workbenchCss, /\.section-content \.filter-builder\s*\{[\s\S]*display:\s*none/);
  assert.match(workbenchCss, /\.section-content \.filter-builder\.mobile-open\s*\{[\s\S]*display:\s*grid/);
});

test('record controls remain responsive and reduced-motion friendly', () => {
  assert.match(workbenchCss, /grid-template-areas:[\s\S]*"primary filter-toggle"[\s\S]*"filters filters"[\s\S]*"active active"/);
  assert.match(workbenchCss, /@media \(max-width: 1100px\)[\s\S]*\.section-content \.table-panel \.table-scroll\s*\{[\s\S]*display:\s*none/);
  assert.match(workbenchCss, /@media \(max-width: 900px\)/);
  assert.match(workbenchCss, /@media \(prefers-reduced-motion: reduce\)/);
  assert.match(workbenchCss, /\.section-content \.row-actions\s*\{[\s\S]*opacity:\s*1/);
  assert.match(workbenchCss, /tbody tr:hover \.row-actions/);
  assert.match(shellCss, /\.studio-next-app \.danger-button\s*\{[\s\S]*color:\s*var\(--ui-danger\)/);
});
