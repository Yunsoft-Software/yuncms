import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';

const source = readFileSync(
  resolve(import.meta.dirname, '../src/screens/UsersScreen.jsx'),
  'utf8',
);

test('Users screen does not require Roles read just to list users', () => {
  assert.match(source, /Promise\.allSettled/);
  assert.match(source, /rolesResult\.status === 'fulfilled'/);
  assert.match(source, /setRolesAvailable\(false\)/);
  assert.match(source, /users\.roleAccessUnavailable/);
});

test('missing role access never falls back to rendering a raw role id', () => {
  assert.match(source, /users\.roleDetailsUnavailable/);
  assert.match(source, /users\.roleUnavailableForCreate/);
  assert.match(source, /role: rolesAvailable \? \(form\.role \|\| null\) : null/);
});

test('managed-user creation copy tells operators verification is automatic', () => {
  assert.match(source, /users\.createDescription/);
});

test('account headings can wrap email addresses without spaces', () => {
  const styles = readFileSync(resolve(import.meta.dirname, '../src/users-mcp-next.css'), 'utf8');
  assert.match(styles, /\.user-detail-page > \.workspace-section-heading h2\s*\{[^}]*overflow-wrap:\s*anywhere/);
});

test('Users screen filters out the public role from assignable user roles and supports email, custom field and password updates', () => {
  assert.match(source, /roles\.filter\(\(role\) => !role\.public\)/);
  assert.match(source, /saveUserDetails/);
  assert.match(source, /changeUserPassword/);
  assert.match(source, /\/users\/\$\{encodeURIComponent\(user\.id\)\}\/password/);
  assert.match(source, /\/schema\/collections\/yuncms_users\/fields/);
});
