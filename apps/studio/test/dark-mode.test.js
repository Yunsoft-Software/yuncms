import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';

const css = readFileSync(resolve(import.meta.dirname, '../src/appearance.css'), 'utf8');

test('dark theme defines shared surface, input and border variables', () => {
  assert.match(css, /:root\[data-theme="dark"\][\s\S]*--studio-surface:/);
  assert.match(css, /:root\[data-theme="dark"\][\s\S]*--studio-surface-muted:/);
  assert.match(css, /:root\[data-theme="dark"\][\s\S]*--studio-input:/);
  assert.match(css, /:root\[data-theme="dark"\][\s\S]*--studio-border:/);
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
    assert.ok(css.includes(selector), `missing dark surface selector: ${selector}`);
  }
  assert.match(css, /background:\s*var\(--studio-surface-muted\)/);
});
