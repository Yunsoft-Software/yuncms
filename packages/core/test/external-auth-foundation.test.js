import assert from 'node:assert/strict';
import test from 'node:test';

import {
  assertLocalRedirectTarget,
  createExternalAuthState,
  decryptExternalAuthSecret,
  encryptExternalAuthSecret,
  hashExternalAuthState,
} from '../src/auth/external-state.js';

test('external auth state is random, hashed and encrypted at rest', () => {
  const secret = '0123456789abcdef0123456789abcdef';
  const state = createExternalAuthState();
  assert.ok(state.length >= 32);
  assert.equal(hashExternalAuthState(state).length, 64);
  const encrypted = encryptExternalAuthSecret(secret, { codeVerifier: 'abc', nonce: 'xyz' });
  assert.doesNotMatch(encrypted, /abc|xyz/);
  assert.deepEqual(decryptExternalAuthSecret(secret, encrypted), { codeVerifier: 'abc', nonce: 'xyz' });
});

test('external auth redirects are local-only', () => {
  assert.equal(assertLocalRedirectTarget('/studio/data'), '/studio/data');
  assert.throws(() => assertLocalRedirectTarget('https://evil.example'), /local path/);
  assert.throws(() => assertLocalRedirectTarget('//evil.example'), /local path/);
  assert.throws(() => assertLocalRedirectTarget('/\\evil.example'), /local path/);
});
