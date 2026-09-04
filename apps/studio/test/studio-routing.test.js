import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';

import { readStudioRoute, studioPath } from '../src/studio-route.js';

const SRC = resolve(import.meta.dirname, '../src');

function source(relativePath) {
  return readFileSync(resolve(SRC, relativePath), 'utf8');
}

test('Studio route parser keeps list, create and nested detail pages addressable', () => {
  assert.deepEqual(readStudioRoute('#/content/products/42'), {
    section: 'content', collection: 'products', view: 'record', recordId: '42',
  });
  assert.deepEqual(readStudioRoute('#/data-model/products/fields/sku'), {
    section: 'data-model', view: 'field', collection: 'products', field: 'sku',
  });
  assert.deepEqual(readStudioRoute('#/roles/role-1/permissions/products/read'), {
    section: 'roles', view: 'permission', roleId: 'role-1', collection: 'products', action: 'read',
  });
  assert.deepEqual(readStudioRoute('#/files/file%2Fone'), {
    section: 'files', view: 'detail', fileId: 'file/one',
  });
  assert.deepEqual(readStudioRoute('#/users/new'), {
    section: 'users', view: 'new', userId: '',
  });
});

test('Studio path builders encode dynamic identifiers and round-trip through the parser', () => {
  assert.equal(studioPath.field('product groups', 'stock/code'), '#/data-model/product%20groups/fields/stock%2Fcode');
  assert.equal(studioPath.permission('role one', 'product groups', 'read'), '#/roles/role%20one/permissions/product%20groups/read');
  assert.equal(studioPath.contentRecord('product groups', 'record/42'), '#/content/product%20groups/record%2F42');
  assert.equal(readStudioRoute(studioPath.newRelation('products', 'm2m')).relationKind, 'm2m');
});

test('App and resource screens use URL navigation for page-level interactions', () => {
  const app = source('App.jsx');
  const dataModel = source('screens/DataModelV2Screen.jsx');
  const roles = source('screens/RolesPermissionsScreen.jsx');
  const content = source('screens/ContentScreen.jsx');
  const files = source('screens/FilesScreen.jsx');
  const users = source('screens/UsersScreen.jsx');

  assert.match(app, /readStudioRoute/);
  assert.match(app, /navigateStudio/);
  assert.match(app, /mobileNavOpen/);
  assert.match(dataModel, /studioPath\.field/);
  assert.match(dataModel, /studioPath\.newField/);
  assert.match(dataModel, /loadCollections\(route\.collection \|\| ''\)/);
  assert.match(dataModel, /\[selected, selectedCollection\?\.collection\]/);
  assert.match(dataModel, /view === 'new-relation' && route\.relationKind \? route\.relationKind : 'm2o'/);
  assert.match(roles, /studioPath\.permission/);
  assert.match(roles, /permission-detail-page/);
  assert.match(content, /studioPath\.contentRecord/);
  assert.match(content, /studioPath\.contentNew/);
  assert.match(content, /loadedRecordKey !== routeRecordKey/);
  assert.match(content, /content\.recordNotFound/);
  assert.match(files, /studioPath\.file/);
  assert.match(users, /studioPath\.user/);
});

test('dense field and permission tabs/modals were replaced with routed page surfaces', () => {
  const dataModel = source('screens/DataModelV2Screen.jsx');
  const roles = source('screens/RolesPermissionsScreen.jsx');
  const files = source('screens/FilesScreen.jsx');
  const routedCss = source('routed-pages.css');

  assert.match(dataModel, /resource-page-nav/);
  assert.doesNotMatch(dataModel, /role="tablist"/);
  assert.match(roles, /permission-collection-grid/);
  assert.doesNotMatch(roles, /<Modal/);
  assert.doesNotMatch(files, /FilePreviewModal/);
  assert.match(routedCss, /@media \(max-width: 900px\)/);
  assert.match(routedCss, /permission-action-row/);
  assert.match(routedCss, /field-detail-grid/);
  assert.match(source('navigation-v2.css'), /sidebar:not\(\.mobile-nav-open\) \.sidebar-nav/);
});
