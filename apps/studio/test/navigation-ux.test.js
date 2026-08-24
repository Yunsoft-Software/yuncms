import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const appSource = await readFile(new URL('../src/App.jsx', import.meta.url), 'utf8');
const dataModelSource = await readFile(new URL('../src/screens/DataModelHomeScreen.jsx', import.meta.url), 'utf8');
const wrapperSource = await readFile(new URL('../src/screens/DataModelScreen.jsx', import.meta.url), 'utf8');
const contentRouteSource = await readFile(new URL('../src/screens/ContentRouteScreen.jsx', import.meta.url), 'utf8');
const cssSource = await readFile(new URL('../src/navigation-model.css', import.meta.url), 'utf8');

test('Data Model uses compact collection rows with visibility, singleton and six-dot drag controls', () => {
  assert.match(wrapperSource, /view === 'collections'/);
  assert.match(wrapperSource, /<DataModelHomeScreen/);
  assert.match(dataModelSource, /navigation-collection-row/);
  assert.match(dataModelSource, /SidebarIcon name="visibility"/);
  assert.match(dataModelSource, /navigation-singleton-icon/);
  assert.match(dataModelSource, /navigation-drag-dots/);
  assert.match(dataModelSource, /draggable/);
  assert.match(dataModelSource, /collectionDropPatches/);
  assert.match(cssSource, /\.navigation-collection-row\.is-hidden[\s\S]*opacity:/);
  assert.match(cssSource, /grid-template-columns:\s*repeat\(2, 3px\)/);
});

test('Data Model supports navigation-only parent groups without creating data collections', () => {
  assert.match(dataModelSource, /createNavigationGroup/);
  assert.match(dataModelSource, /deleteNavigationGroup/);
  assert.match(dataModelSource, /menuOnlyGroup/);
  assert.match(dataModelSource, /navigation-group-block/);
  assert.doesNotMatch(dataModelSource, /\/items\/.*group/);
});

test('Content mode replaces the module menu with only grouped content navigation', () => {
  assert.match(appSource, /contentNavFocused/);
  assert.match(appSource, /content-focus-nav/);
  assert.match(appSource, /navigation\.backToMain/);
  assert.match(appSource, /buildNavigationModel\(contentCollections, navigationGroupRows/);
  assert.match(appSource, /setContentNavFocused\(true\)/);
  assert.match(cssSource, /\.content-focus-nav/);
});

test('singleton Content routes skip list view and resolve directly to record or create form', () => {
  assert.match(appSource, /<ContentRouteScreen/);
  assert.match(contentRouteSource, /collectionMeta\?\.singleton/);
  assert.match(contentRouteSource, /limit=1/);
  assert.match(contentRouteSource, /singletonDestination/);
});
