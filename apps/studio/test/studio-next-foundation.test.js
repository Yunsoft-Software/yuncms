import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';

const SRC = resolve(import.meta.dirname, '../src');
const studioCss = readFileSync(resolve(SRC, 'studio.css'), 'utf8');
const tokensCss = readFileSync(resolve(SRC, 'studio-next-tokens.css'), 'utf8');
const authCss = readFileSync(resolve(SRC, 'auth-settings-next.css'), 'utf8');
const compatCss = readFileSync(resolve(SRC, 'studio-compat.css'), 'utf8');
const railSource = readFileSync(resolve(SRC, 'components/AppRail.jsx'), 'utf8');
const brandSource = readFileSync(resolve(SRC, 'components/StudioBrand.jsx'), 'utf8');
const loginSource = readFileSync(resolve(SRC, 'screens/LoginScreen.jsx'), 'utf8');
const authActionSource = readFileSync(resolve(SRC, 'screens/AuthActionScreen.jsx'), 'utf8');
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
  const tokenIndex = studioCss.indexOf("@import './studio-next-tokens.css';");
  assert.ok(tokenIndex > -1);
  for (const file of [
    './content-workbench-next.css',
    './files-next.css',
    './data-model-next.css',
    './access-next.css',
    './ai-next.css',
    './auth-settings-next.css',
  ]) {
    assert.ok(studioCss.indexOf(`@import '${file}';`) > tokenIndex, `${file} should load after tokens`);
  }
  assert.ok(studioCss.indexOf("@import './studio-compat.css';") > studioCss.indexOf("@import './auth-settings-next.css';"));
});

test('sign-in removes application navigation and becomes a dedicated responsive surface', () => {
  assert.match(railSource, /authSurface \? 'auth-surface' : ''/);
  assert.match(railSource, /!authSurface && <AppRail \/>/);
  assert.match(compatCss, /\.studio-next-frame\.auth-surface[\s\S]*display:\s*block/);
  assert.match(authCss, /\.auth-shell[\s\S]*grid-template-columns/);
  assert.match(brandSource, /export function AuthBrandPanel/);
  assert.match(brandSource, /auth-brand-logo-stage/);
  assert.match(loginSource, /<AuthBrandPanel \/>/);
  assert.match(authActionSource, /<AuthBrandPanel \/>/);
  assert.match(authCss, /\.auth-brand-showcase/);
  assert.match(authCss, /\.auth-brand-logo-stage/);
  assert.match(authCss, /@media \(prefers-reduced-motion: reduce\)[\s\S]*\.auth-brand-orbit-one/);
  assert.match(authCss, /@media \(max-width: 680px\)/);
  assert.match(authCss, /\.auth-footer\s*\{[\s\S]*?align-self:\s*stretch;/);
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
