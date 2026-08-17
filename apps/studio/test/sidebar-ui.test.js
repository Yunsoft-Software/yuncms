import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';

const SRC = resolve(import.meta.dirname, '../src');
const appSource = readFileSync(resolve(SRC, 'App.jsx'), 'utf8');
const brandSource = readFileSync(resolve(SRC, 'components/StudioBrand.jsx'), 'utf8');
const iconSource = readFileSync(resolve(SRC, 'components/SidebarIcon.jsx'), 'utf8');
const navigationCss = readFileSync(resolve(SRC, 'navigation-v2.css'), 'utf8');

test('sidebar uses focused accordion groups, icons and a full collapse state', () => {
  assert.match(appSource, /function AccordionGroup/);
  assert.match(appSource, /sidebarCollapsed/);
  assert.match(appSource, /aria-expanded/);
  assert.match(appSource, /SidebarIcon/);
  assert.match(appSource, /CollectionIcon/);
  assert.match(iconSource, /content:/);
  assert.match(iconSource, /roles:/);
  assert.match(iconSource, /collapse:/);
});

test('Files is a direct sidebar destination instead of a one-item Library accordion', () => {
  assert.doesNotMatch(appSource, /id="library"/);
  assert.doesNotMatch(appSource, /librarySections/);
  assert.match(appSource, /nav-item-root/);
  assert.match(appSource, /openSection\('files'\)/);
});

test('collection navigation uses collection metadata ordering and icons', () => {
  assert.match(appSource, /sortContentCollections/);
  assert.match(appSource, /collectionUi\(entry\)\.icon/);
  assert.match(navigationCss, /\.nav-group-title[\s\S]*font-size:\s*14px/);
  assert.match(navigationCss, /\.nav-item-child[\s\S]*font-size:\s*13px/);
});

test('sidebar identity shows role name rather than raw role UUID', () => {
  assert.match(appSource, /session\.user\?\.role_name/);
  assert.doesNotMatch(appSource, /<small>\{session\.user\?\.role\s*\|\|/);
});

test('logo component renders logo only without YunCMS Studio copy', () => {
  assert.doesNotMatch(brandSource, /studio-brand-copy/);
  assert.doesNotMatch(brandSource, /<span>Studio<\/span>/);
  assert.match(brandSource, /resolveStudioLogo/);
});
