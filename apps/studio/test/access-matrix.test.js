import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';

const SRC = resolve(import.meta.dirname, '../src');
const accessSource = readFileSync(resolve(SRC, 'screens/RolesPermissionsScreen.jsx'), 'utf8');
const accessCss = readFileSync(resolve(SRC, 'access-next.css'), 'utf8');
const stateCss = readFileSync(resolve(SRC, 'access-matrix-states.css'), 'utf8');

test('permission overview renders four action columns per collection', () => {
  assert.match(accessSource, /const ACTIONS = \['read', 'create', 'update', 'delete'\]/);
  assert.match(accessSource, /permission-collection-grid/);
  assert.match(accessSource, /permission-action-row/);
  assert.match(accessCss, /grid-template-columns: repeat\(4, minmax\(104px, 1fr\)\)/);
});

test('permission matrix communicates configured and restricted states with text', () => {
  assert.match(accessSource, /advanced \? t\('roles\.restricted'\) : t\('roles\.allRecords'\)/);
  assert.match(accessSource, /t\('roles\.permissionDisabled'\)/);
  assert.match(stateCss, /:has\(\.permission-toggle\.enabled\)/);
  assert.match(stateCss, /content: '✓'/);
});
