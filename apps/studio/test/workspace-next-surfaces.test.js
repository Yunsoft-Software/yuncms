import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';

const SRC = resolve(import.meta.dirname, '../src');
const studioCss = readFileSync(resolve(SRC, 'studio.css'), 'utf8');
const shellCss = readFileSync(resolve(SRC, 'studio-next.css'), 'utf8');
const filesCss = readFileSync(resolve(SRC, 'files-next.css'), 'utf8');
const schemaCss = readFileSync(resolve(SRC, 'data-model-next.css'), 'utf8');
const accessCss = readFileSync(resolve(SRC, 'access-next.css'), 'utf8');

test('Studio loads the dedicated Files, Data Model and Access workspace layers after the base redesign', () => {
  for (const stylesheet of ['files-next.css', 'data-model-next.css', 'access-next.css']) {
    assert.match(studioCss, new RegExp(`@import './${stylesheet.replace('.', '\\.')}'`));
  }
  assert.ok(studioCss.indexOf("@import './studio-next.css';") < studioCss.indexOf("@import './files-next.css';"));
});

test('Files presents an asset grid and a metadata-oriented detail workspace', () => {
  assert.match(filesCss, /\.file-grid[\s\S]*repeat\(auto-fill, minmax\(190px, 1fr\)\)/);
  assert.match(filesCss, /\.file-card-actions[\s\S]*opacity:\s*0/);
  assert.match(filesCss, /\.file-card:focus-within[\s\S]*--ui-focus-ring/);
  assert.match(filesCss, /\.file-detail-page[\s\S]*grid-template-areas/);
  assert.match(filesCss, /@media \(max-width: 900px\)/);
  assert.match(shellCss, /\.studio-next-app \.workspace-toolbar\s*\{[\s\S]*justify-content:\s*stretch/);
});

test('Data Model separates collection navigation from the schema workbench', () => {
  assert.match(schemaCss, /\.data-model-v2-layout[\s\S]*grid-template-columns:\s*minmax\(220px, 248px\)/);
  assert.match(schemaCss, /\.data-model-collections-panel[\s\S]*border-right:\s*1px solid var\(--ui-border\)/);
  assert.match(schemaCss, /\.resource-page-nav button\[aria-current='page'\]::after/);
  assert.match(schemaCss, /\.field-workspace-list[\s\S]*border:\s*1px solid var\(--ui-border\)/);
});

test('Access renders permissions as a compact four-action audit grid without relying on color alone', () => {
  assert.match(accessCss, /\.permission-action-list[\s\S]*repeat\(4, minmax\(108px, 1fr\)\)/);
  assert.match(accessCss, /\.permission-action-meta strong/);
  assert.match(accessCss, /\.permission-toggle\.enabled/);
  assert.match(accessCss, /\.permission-state-badge\.disabled/);
  assert.match(accessCss, /@media \(max-width: 620px\)/);
});

test('new workspace motion has reduced-motion fallbacks', () => {
  assert.match(filesCss, /@media \(prefers-reduced-motion: reduce\)/);
  assert.match(schemaCss, /@media \(prefers-reduced-motion: reduce\)/);
  assert.match(accessCss, /@media \(prefers-reduced-motion: reduce\)/);
});
