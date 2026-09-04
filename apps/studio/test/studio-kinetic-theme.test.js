import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';

const SRC = resolve(import.meta.dirname, '../src');
const studioCss = readFileSync(resolve(SRC, 'studio.css'), 'utf8');
const kineticCss = readFileSync(resolve(SRC, 'studio-kinetic.css'), 'utf8');
const contentSource = readFileSync(resolve(SRC, 'screens/ContentScreen.jsx'), 'utf8');
const dataModelHomeSource = readFileSync(resolve(SRC, 'screens/DataModelHomeScreen.jsx'), 'utf8');
const navigationEnSource = readFileSync(resolve(SRC, 'locales/navigation-en.js'), 'utf8');
const navigationTrSource = readFileSync(resolve(SRC, 'locales/navigation-tr.js'), 'utf8');

test('Studio loads the kinetic theme after workspace styles and before compatibility fallbacks', () => {
  const kineticIndex = studioCss.indexOf("@import './studio-kinetic.css';");
  assert.ok(kineticIndex > studioCss.indexOf("@import './users-mcp-next.css';"));
  assert.ok(kineticIndex < studioCss.indexOf("@import './studio-compat.css';"));
});

test('kinetic theme defines the approved spectrum and complete light and dark surfaces', () => {
  for (const token of [
    '--yun-spectrum-one: #ff6238',
    '--yun-spectrum-two: #ca3e7b',
    '--yun-spectrum-three: #16b8a6',
    '--yun-canvas:',
    '--yun-surface:',
    '--yun-ink:',
    '--yun-line:',
  ]) {
    assert.ok(kineticCss.includes(token), `missing kinetic token: ${token}`);
  }
  assert.match(kineticCss, /:root\[data-theme='dark'\][\s\S]*--yun-canvas:\s*#090b0e/);
  assert.match(kineticCss, /\.studio-app-rail[\s\S]*var\(--yun-rail\)/);
});

test('kinetic actions remain neutral outside the app shell and checkboxes use the live color', () => {
  assert.match(kineticCss, /\.primary-button\s*\{[^}]*background: var\(--yun-action-bg\)/s);
  assert.doesNotMatch(kineticCss, /\.studio-next-app \.primary-button\s*\{[^}]*background: var\(--yun-action-bg\)/s);
  assert.match(kineticCss, /input\[type='checkbox'\]\s*\{[^}]*accent-color: var\(--yun-spectrum-three\)/s);
});

test('content workspace renders collection identity and real record and field counts in the spectrum hero', () => {
  assert.match(contentSource, /className="content-hero-grid"/);
  assert.match(contentSource, /className="content-hero-stats"/);
  assert.match(contentSource, /meta\?\.total_count \?\? '—'/);
  assert.match(contentSource, /<strong>\{fields\.length\}<\/strong>/);
  assert.match(kineticCss, /\.section-content \.content-toolbar[\s\S]*linear-gradient\(118deg/);
  assert.match(kineticCss, /\.section-content \.content-toolbar p:last-child[\s\S]*background:\s*transparent/);
  assert.match(kineticCss, /\.studio-next-app \.table-panel td:last-child[\s\S]*position:\s*sticky[\s\S]*min-width:\s*190px/);
});

test('kinetic motion is responsive and respects reduced-motion preference', () => {
  assert.match(kineticCss, /@media \(max-width: 900px\)/);
  assert.match(kineticCss, /@media \(max-width: 420px\)/);
  assert.match(kineticCss, /@media \(prefers-reduced-motion: reduce\)/);
  assert.match(kineticCss, /\.section-content \.content-toolbar,[\s\S]*animation:\s*none !important/);
});

test('AI setup state uses a bounded expressive surface instead of an empty disabled chat canvas', () => {
  assert.match(kineticCss, /\.ai-setup-card\s*\{[^}]*min-height:\s*210px/s);
  assert.match(kineticCss, /\.ai-setup-card::before\s*\{[^}]*animation:\s*yun-orbit-drift/s);
});

test('Data Model home uses the same identity language without duplicating toolbar actions', () => {
  assert.match(dataModelHomeSource, /className="navigation-model-hero"/);
  assert.match(dataModelHomeSource, /className="navigation-model-hero-stats"/);
  assert.match(dataModelHomeSource, /<strong>\{collectionCount\}<\/strong>/);
  assert.match(dataModelHomeSource, /<strong>\{model\.groups\.length\}<\/strong>/);
  assert.equal((dataModelHomeSource.match(/className="navigation-toolbar-actions"/g) ?? []).length, 1);
  assert.match(kineticCss, /\.navigation-model-hero[\s\S]*linear-gradient\(122deg/);
  assert.match(navigationEnSource, /'navigation\.folders': 'Folders'/);
  assert.match(navigationTrSource, /'navigation\.folders': 'Klasörler'/);
});
