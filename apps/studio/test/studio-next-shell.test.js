import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';

const SRC = resolve(import.meta.dirname, '../src');
const mainSource = readFileSync(resolve(SRC, 'main.jsx'), 'utf8');
const railSource = readFileSync(resolve(SRC, 'components/AppRail.jsx'), 'utf8');
const shellCss = readFileSync(resolve(SRC, 'studio-next.css'), 'utf8');

test('Studio mounts the workbench frame inside settings context', () => {
  assert.match(mainSource, /import \{ StudioNextFrame \} from '\.\/components\/AppRail\.jsx'/);
  assert.match(mainSource, /<StudioSettingsProvider>[\s\S]*<StudioNextFrame>[\s\S]*<DialogProvider>[\s\S]*<App \/>/);
  assert.match(mainSource, /import '\.\/studio-next\.css'/);
});

test('application rail exposes stable top-level Studio destinations', () => {
  assert.match(railSource, /id: 'content'/);
  assert.match(railSource, /id: 'files'/);
  assert.match(railSource, /id: 'data-model'/);
  assert.match(railSource, /id: 'ai'/);
  assert.match(railSource, /id: 'access'/);
  assert.match(railSource, /id: 'settings'/);
  assert.match(railSource, /studioPath\.content\(route\.section === 'content' \? route\.collection : ''\)/);
  assert.match(railSource, /route\.section === 'users' \|\| route\.section === 'roles'/);
  assert.match(railSource, /route\.section === 'appearance' \|\| route\.section === 'mcp'/);
  assert.match(railSource, /aria-current=\{active \? 'page' : undefined\}/);
});

test('workbench shell uses semantic tokens and compact navigation', () => {
  assert.match(shellCss, /--ui-canvas:/);
  assert.match(shellCss, /--ui-surface-selected:/);
  assert.match(shellCss, /--ui-motion-fast:\s*110ms/);
  assert.match(shellCss, /\.studio-next-frame\s*\{[\s\S]*grid-template-columns:\s*56px minmax\(0, 1fr\)/);
  assert.match(shellCss, /\.studio-next-app \.main-content > \.page-header\s*\{[\s\S]*display:\s*none/);
  assert.match(shellCss, /\.studio-next-app \.sidebar-nav > \.nav-item-root\s*\{[\s\S]*display:\s*none/);
});

test('workbench shell includes responsive and reduced-motion behavior', () => {
  assert.match(shellCss, /@media \(max-width: 760px\)/);
  assert.match(shellCss, /position:\s*fixed;[\s\S]*inset:\s*auto 0 0/);
  assert.match(shellCss, /@media \(prefers-reduced-motion: reduce\)/);
  assert.match(shellCss, /transition:\s*none !important/);
});
