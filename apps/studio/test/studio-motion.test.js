import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';

const SRC = resolve(import.meta.dirname, '../src');
const motionCss = readFileSync(resolve(SRC, 'studio-motion.css'), 'utf8');
const studioCss = readFileSync(resolve(SRC, 'studio.css'), 'utf8');

test('Studio loads one shared motion contract', () => {
  assert.match(studioCss, /@import '\.\/studio-motion\.css'/);
  assert.match(motionCss, /--ui-motion-fast: var\(--motion-fast\)/);
  assert.match(motionCss, /--ui-motion-base: var\(--motion-ui\)/);
  assert.match(motionCss, /--ui-motion-slow: var\(--motion-panel\)/);
});

test('reduced motion covers overlays, graph and upload feedback', () => {
  assert.match(motionCss, /@media \(prefers-reduced-motion: reduce\)/);
  for (const selector of [
    '.studio-inspector',
    '.command-palette-dialog',
    '.relation-picker-menu',
    '.data-view-options-popover',
    '.file-library-drop-overlay',
    '.schema-graph-node',
    '.relation-diagram-edge',
    '.upload-queue-item',
  ]) {
    assert.match(motionCss, new RegExp(selector.replaceAll('.', '\\.')));
  }
  assert.match(motionCss, /transition-duration: 0ms !important/);
  assert.match(motionCss, /transform: none !important/);
});
