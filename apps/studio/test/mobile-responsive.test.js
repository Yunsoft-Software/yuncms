import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';

const SRC = resolve(import.meta.dirname, '../src');

function source(relativePath) {
  return readFileSync(resolve(SRC, relativePath), 'utf8');
}

test('Studio mobile shell resets page scroll and never inherits the desktop collapsed brand', () => {
  const app = source('App.jsx');
  const brand = source('components/StudioBrand.jsx');
  const css = source('mobile-responsive.css');

  assert.match(app, /useLayoutEffect/);
  assert.match(app, /window\.scrollTo\(\{ top: 0, left: 0, behavior: 'instant' \}\)/);
  assert.match(app, /const navigationCollapsed = !mobileLayout && sidebarCollapsed/);
  assert.match(app, /section-\$\{section\} route-\$\{route\.view \|\| 'list'\}/);
  assert.match(css, /@media \(max-width: 760px\)/);
  assert.match(css, /grid-template-rows: auto minmax\(0, 1fr\)/);
  assert.match(css, /\.sidebar-brand-row,[\s\S]*justify-content: space-between/);
  assert.match(css, /\.main-content > \.page-header[\s\S]*display: none/);
  assert.match(css, /\.mobile-menu-label[\s\S]*display: inline/);
  assert.match(brand, /studio-brand-fallback-full/);
  assert.match(brand, /studio-brand-fallback-compact/);
});

test('dense content and user tables become readable cards on mobile', () => {
  const content = source('screens/ContentScreen.jsx');
  const users = source('screens/UsersScreen.jsx');
  const css = source('mobile-responsive.css');

  assert.match(content, /mobile-filter-toggle/);
  assert.match(content, /mobile-record-list/);
  assert.match(users, /mobile-user-list/);
  assert.match(css, /\.section-content \.table-panel \.table-scroll/);
  assert.match(css, /\.section-users \.users-table-panel \.table-scroll/);
  assert.match(css, /\.mobile-record-list,[\s\S]*\.mobile-user-list[\s\S]*display: grid/);
});

test('mobile data-model controls use page-sized selectors without horizontal card overflow', () => {
  const fieldBuilder = source('components/FieldBuilder.jsx');
  const css = source('mobile-responsive.css');

  assert.match(fieldBuilder, /mobile-field-type-select/);
  assert.match(fieldBuilder, /FIELD_TYPE_GROUPS\.map/);
  assert.match(css, /\.field-type-browser[\s\S]*display: none/);
  assert.match(css, /\.mobile-field-type-select[\s\S]*display: grid/);
  assert.match(css, /\.resource-page-nav[\s\S]*grid-template-columns: repeat\(3, minmax\(0, 1fr\)\)/);
  assert.match(css, /\.relation-type-picker[\s\S]*grid-template-columns: 1fr/);
  assert.match(css, /\.relation-type-card[\s\S]*width: 100%/);
});

test('mobile stylesheet stays in the centralized cascade and public-role numeric flags cannot leak into the UI', () => {
  const main = source('main.jsx');
  const studioCss = source('studio.css');
  const roles = source('screens/RolesPermissionsScreen.jsx');

  assert.match(main, /import '\.\/studio\.css';/);
  const routedIndex = studioCss.indexOf("@import './routed-pages.css';");
  const mobileIndex = studioCss.indexOf("@import './mobile-responsive.css';");
  const semanticIndex = studioCss.indexOf("@import './studio-next.css';");
  assert.ok(routedIndex > -1 && mobileIndex > routedIndex);
  assert.ok(semanticIndex > mobileIndex, 'semantic Studio layers should override the legacy mobile baseline when needed');
  assert.match(main, /window\.history\.scrollRestoration = 'manual'/);
  assert.match(main, /window\.scrollTo\(\{ top: 0, left: 0, behavior: 'instant' \}\)/);
  assert.match(roles, /Boolean\(selectedRole\.public\)/);
  assert.doesNotMatch(roles, /\{selectedRole\.public && \(/);
});
