import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const apiSource = await readFile(new URL('../src/api.js', import.meta.url), 'utf8');
const loginSource = await readFile(new URL('../src/screens/LoginScreen.jsx', import.meta.url), 'utf8');

test('Studio external auth uses one-time browser handoff instead of URL tokens', () => {
  assert.match(apiSource, /export async function exchangeAuthCode/);
  assert.match(apiSource, /body: \{ auth_code: authCode \}/);
  assert.match(loginSource, /readBrowserAuthCode/);
  assert.match(loginSource, /exchangeAuthCode\(authCode\)/);
  assert.match(loginSource, /clearBrowserAuthCode\(\)/);
  assert.doesNotMatch(loginSource, /access_token.*URLSearchParams/);
  assert.doesNotMatch(loginSource, /refresh_token.*URLSearchParams/);
});

test('Studio renders browser providers and routes LDAP through credential exchange', () => {
  assert.match(apiSource, /export async function authProviders/);
  assert.match(apiSource, /export function externalLoginUrl/);
  assert.match(apiSource, /export async function loginWithProvider/);
  assert.match(loginSource, /provider\.driver !== 'ldap'/);
  assert.match(loginSource, /provider\.driver === 'ldap'/);
  assert.match(loginSource, /window\.location\.assign\(externalLoginUrl/);
  assert.match(loginSource, /loginWithProvider\(ldapProvider\.id/);
});
