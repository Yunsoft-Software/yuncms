import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const appSource = await readFile(new URL('../src/App.jsx', import.meta.url), 'utf8');
const dataModelSource = await readFile(new URL('../src/screens/DataModelHomeScreen.jsx', import.meta.url), 'utf8');
const wrapperSource = await readFile(new URL('../src/screens/DataModelScreen.jsx', import.meta.url), 'utf8');
const contentRouteSource = await readFile(new URL('../src/screens/ContentRouteScreen.jsx', import.meta.url), 'utf8');
const iconSource = await readFile(new URL('../src/components/SidebarIcon.jsx', import.meta.url), 'utf8');
const cssSource = await readFile(new URL('../src/navigation-model.css', import.meta.url), 'utf8');

test('Data Model uses compact collection rows with visibility, singleton and six-dot drag controls', () => {
  assert.match(wrapperSource, /view === 'collections'/);
  assert.match(wrapperSource, /<DataModelHomeScreen/);
  assert.match(dataModelSource, /navigation-collection-row/);
  assert.match(dataModelSource, /entry\.hidden \? 'visibility-off' : 'visibility'/);
  assert.match(iconSource, /'visibility-off':/);
  assert.match(dataModelSource, /navigation-singleton-icon/);
  assert.match(dataModelSource, /navigation-drag-dots/);
  assert.match(dataModelSource, /onPointerDown/);
  assert.match(dataModelSource, /window\.addEventListener\('pointerup'/);
  assert.match(dataModelSource, /window\.addEventListener\('mouseup'/);
  assert.match(dataModelSource, /document\.elementFromPoint/);
  assert.doesNotMatch(dataModelSource, /onDragStart/);
  assert.match(dataModelSource, /navigationDropPatches/);
  assert.match(cssSource, /\.navigation-collection-row\.is-hidden[\s\S]*opacity:/);
  assert.match(cssSource, /\.navigation-drag-handle[\s\S]*touch-action:\s*none/);
  assert.match(cssSource, /grid-template-columns:\s*repeat\(2, 3px\)/);
});

test('Data Model supports schema-less folders in one ordered tree with Directus-like collapse behavior', () => {
  assert.match(dataModelSource, /createNavigationGroup/);
  assert.match(dataModelSource, /deleteNavigationGroup/);
  assert.match(dataModelSource, /model\.nodes/);
  assert.match(dataModelSource, /navigation-group-chevron/);
  assert.match(dataModelSource, /value="locked"/);
  assert.match(dataModelSource, /navigationPointerPosition/);
  assert.match(dataModelSource, /data-navigation-drop-position="inside"/);
  assert.match(cssSource, /\.navigation-group-row\.is-drop-inside/);
  assert.match(cssSource, /\.navigation-collection-row\.is-drop-before::before/);
  assert.doesNotMatch(cssSource, /\.navigation-group-block/);
  assert.doesNotMatch(dataModelSource, /\/items\/.*group/);
});

test('Content mode renders the same interleaved order and persisted folder collapse behavior', () => {
  assert.match(appSource, /contentNavFocused/);
  assert.match(appSource, /content-focus-nav/);
  assert.match(appSource, /navigation\.backToMain/);
  assert.match(appSource, /buildNavigationModel\(contentCollections, navigationGroupRows/);
  assert.match(appSource, /contentNavigation\.nodes\.map/);
  assert.match(appSource, /node\.group\.collapse === 'locked'/);
  assert.match(appSource, /setContentNavFocused\(true\)/);
  assert.match(cssSource, /\.content-focus-nav/);
  assert.match(cssSource, /\.content-focus-group-trigger/);
});

test('singleton Content routes skip list view and resolve directly to record or create form', () => {
  assert.match(appSource, /<ContentRouteScreen/);
  assert.match(contentRouteSource, /collectionMeta\?\.singleton/);
  assert.match(contentRouteSource, /limit=1/);
  assert.match(contentRouteSource, /singletonDestination/);
});
