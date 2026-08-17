import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';

const appearanceCss = readFileSync(resolve(import.meta.dirname, '../src/appearance.css'), 'utf8');
const visualCss = readFileSync(resolve(import.meta.dirname, '../src/visual-fixes.css'), 'utf8');
const mainSource = readFileSync(resolve(import.meta.dirname, '../src/main.jsx'), 'utf8');

test('dark theme defines shared surface, input and border variables', () => {
  assert.match(appearanceCss, /:root\[data-theme="dark"\][\s\S]*--studio-surface:/);
  assert.match(appearanceCss, /:root\[data-theme="dark"\][\s\S]*--studio-surface-muted:/);
  assert.match(appearanceCss, /:root\[data-theme="dark"\][\s\S]*--studio-input:/);
  assert.match(appearanceCss, /:root\[data-theme="dark"\][\s\S]*--studio-border:/);
});

test('legacy and new controls are explicitly normalized for dark mode', () => {
  for (const selector of [
    '.field-row',
    '.permission-matrix-heading',
    '.field-choice',
    '.control-placeholder',
    '.pagination-footer',
    '.file-dropzone',
    '.file-field-preview-card',
    '.relation-existing-panel',
  ]) {
    assert.ok(appearanceCss.includes(selector), `missing dark surface selector: ${selector}`);
  }
  assert.match(appearanceCss, /background:\s*var\(--studio-surface-muted\)/);
});

test('pagination and sticky permission columns never force white surfaces in dark mode', () => {
  assert.match(mainSource, /visual-fixes\.css/);
  for (const selector of ['.pagination', '.permission-matrix td:first-child', '.permission-list-controls']) {
    assert.ok(visualCss.includes(selector), `missing visual correction: ${selector}`);
  }
  assert.match(visualCss, /:root\[data-theme="dark"\][\s\S]*\.pagination/);
  assert.match(visualCss, /background:\s*var\(--studio-surface\)/);
  assert.doesNotMatch(visualCss, /background(?:-color)?:\s*(?:#fff(?:fff)?|white)\b/i);
});
