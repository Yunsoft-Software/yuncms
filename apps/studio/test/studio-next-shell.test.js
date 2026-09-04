import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';

const SRC = resolve(import.meta.dirname, '../src');
const mainSource = readFileSync(resolve(SRC, 'main.jsx'), 'utf8');
const railSource = readFileSync(resolve(SRC, 'components/AppRail.jsx'), 'utf8');
const shellCss = readFileSync(resolve(SRC, 'studio-next.css'), 'utf8');
const compatCss = readFileSync(resolve(SRC, 'studio-compat.css'), 'utf8');

test('Studio mounts the workbench frame inside settings context', () => {
  assert.match(mainSource, /import \{ DialogProvider, StudioNextFrame \} from '\.\/components\/index\.js'/);
  assert.match(mainSource, /<StudioSettingsProvider>[\s\S]*<StudioNextFrame>[\s\S]*<DialogProvider>[\s\S]*<App \/>/);
  assert.match(mainSource, /import '\.\/studio\.css'/);
  assert.doesNotMatch(mainSource, /components\/AppRail\.jsx/);
  assert.doesNotMatch(mainSource, /studio-next\.css/);
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

test('workbench frame exposes route and authentication state without relying on relational selectors', () => {
  assert.match(railSource, /className=\{`studio-next-frame section-\$\{section\} \$\{authSurface \? 'auth-surface' : ''\}`\}/);
  assert.match(railSource, /MutationObserver\(updateAuthSurface\)/);
  assert.match(railSource, /!authSurface && <AppRail \/>/);
  assert.match(compatCss, /\.studio-next-frame\.section-files/);
  assert.match(compatCss, /\.studio-next-frame\.section-ai/);
  assert.match(compatCss, /\.studio-next-frame\.section-data-model/);
  assert.match(compatCss, /\.studio-next-frame\.auth-surface/);
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
  assert.match(shellCss, /@media \(max-width: 900px\)/);
  assert.match(shellCss, /position:\s*fixed;[\s\S]*inset:\s*auto 0 0/);
  assert.match(shellCss, /@media \(prefers-reduced-motion: reduce\)/);
  assert.match(shellCss, /transition:\s*none !important/);
  assert.match(compatCss, /@media \(max-width: 900px\)/);
});
