import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';

const source = readFileSync(resolve(import.meta.dirname, '../src/screens/RolesPermissionsScreen.jsx'), 'utf8');

test('public role has explicit anonymous-access guidance', () => {
  assert.match(source, /selectedRole\.public/);
  assert.match(source, /roles\.publicAccessTitle/);
  assert.match(source, /roles\.publicAccessDescription/);
});

test('permission UI separates simple toggles from restricted configuration', () => {
  assert.match(source, /function isRestricted/);
  assert.match(source, /roles\.accessOverview/);
  assert.match(source, /roles\.restrictedActions/);
  assert.match(source, /permission-configure/);
  assert.match(source, /roles\.quickAuditHint/);
});

test('permission matrix includes only explicit system resources and marks protected actions', () => {
  assert.match(source, /filter\(isPermissionCollection\)/);
  assert.match(source, /permissionResourcePolicy/);
  assert.match(source, /canConfigurePermission/);
  assert.match(source, /canUseAdvancedPermission/);
  assert.match(source, /roles\.systemResource/);
  assert.match(source, /roles\.protected/);
  assert.match(source, /roles\.systemAccessHint/);
});
