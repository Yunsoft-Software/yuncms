import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';

const SRC = resolve(import.meta.dirname, '../src');
const mainSource = readFileSync(resolve(SRC, 'main.jsx'), 'utf8');
const tokensCss = readFileSync(resolve(SRC, 'studio-next-tokens.css'), 'utf8');
const authCss = readFileSync(resolve(SRC, 'auth-settings-next.css'), 'utf8');
const aiCss = readFileSync(resolve(SRC, 'ai-next.css'), 'utf8');

test('semantic Studio tokens cover workspace borders, state colors, focus and motion', () => {
  for (const token of [
    '--ui-border-strong',
    '--ui-success',
    '--ui-warning',
    '--ui-focus-ring',
    '--ui-overlay',
    '--motion-fast',
    '--motion-ui',
    '--motion-panel',
    '--ease-ui',
    '--ease-out',
  ]) {
    assert.match(tokensCss, new RegExp(token.replaceAll('-', '\\-')));
  }
  assert.match(tokensCss, /prefers-reduced-motion: reduce/);
});

test('workspace-specific CSS loads after the semantic token bridge', () => {
  const tokenIndex = mainSource.indexOf("./studio-next-tokens.css");
  assert.ok(tokenIndex > -1);
  for (const file of [
    './content-workbench-next.css',
    './files-next.css',
    './data-model-next.css',
    './access-next.css',
    './ai-next.css',
    './auth-settings-next.css',
  ]) {
    assert.ok(mainSource.indexOf(file) > tokenIndex, `${file} should load after tokens`);
  }
});

test('sign-in removes application navigation and becomes a dedicated responsive surface', () => {
  assert.match(authCss, /studio-next-frame:has\(\.auth-layout\) > \.studio-app-rail[\s\S]*display:\s*none/);
  assert.match(authCss, /\.auth-shell[\s\S]*grid-template-columns/);
  assert.match(authCss, /@media \(max-width: 680px\)/);
});

test('Appearance uses a settings-and-preview layout instead of generic stacked panels', () => {
  assert.match(authCss, /\.appearance-layout[\s\S]*grid-template-columns/);
  assert.match(authCss, /\.appearance-preview[\s\S]*position:\s*sticky/);
  assert.match(authCss, /\.appearance-grid[\s\S]*repeat\(2, minmax\(0, 1fr\)\)/);
});

test('AI hides decorative orbs and keeps operation/access states visible', () => {
  assert.match(aiCss, /\.ai-setup-card \.ai-orb,[\s\S]*display:\s*none/);
  assert.match(aiCss, /\.ai-operation\.success/);
  assert.match(aiCss, /\.ai-operation\.failed/);
  assert.match(aiCss, /\.ai-access-option\.selected/);
  assert.match(aiCss, /prefers-reduced-motion: reduce/);
});
