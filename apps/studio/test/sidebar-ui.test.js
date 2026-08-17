import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';

const SRC = resolve(import.meta.dirname, '../src');
const appSource = readFileSync(resolve(SRC, 'App.jsx'), 'utf8');
const brandSource = readFileSync(resolve(SRC, 'components/StudioBrand.jsx'), 'utf8');
const iconSource = readFileSync(resolve(SRC, 'components/SidebarIcon.jsx'), 'utf8');

test('sidebar uses accordion groups, icons and a full collapse state', () => {
  assert.match(appSource, /function AccordionGroup/);
  assert.match(appSource, /sidebarCollapsed/);
  assert.match(appSource, /aria-expanded/);
  assert.match(appSource, /SidebarIcon/);
  assert.match(iconSource, /content:/);
  assert.match(iconSource, /roles:/);
  assert.match(iconSource, /collapse:/);
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
