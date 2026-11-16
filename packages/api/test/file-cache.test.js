import assert from 'node:assert/strict';
import test from 'node:test';
import { createAccountability, createPublicAccountability, createSystemAccountability } from '@yunsoft/yuncms-core';
import { fileContentCacheControl } from '../src/file-cache.js';

test('file cache policy permits revalidation only for explicit anonymous Public accountability', () => {
  assert.equal(fileContentCacheControl(createPublicAccountability({ role: 'public-role' })), 'public, no-cache, must-revalidate');
  for (const accountability of [undefined, null, {}, { public: 'true' }, { public: true, user: 'user' },
    { public: true, admin: true }, { public: true, system: true }, createSystemAccountability(),
    createAccountability({ user: 'user', role: 'role' }), createAccountability({ user: 'owner', admin: true })]) {
    assert.equal(fileContentCacheControl(accountability), 'private, no-store');
  }
});
