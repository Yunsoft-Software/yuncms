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
