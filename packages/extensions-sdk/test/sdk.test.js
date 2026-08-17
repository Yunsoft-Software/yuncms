import test from 'node:test';
import assert from 'node:assert/strict';

import { defineEndpoint, defineHook, isYunCmsExtension } from '../src/index.js';

test('defineEndpoint creates a frozen endpoint definition', () => {
  const register = () => {};
  const extension = defineEndpoint(register);

  assert.equal(extension.type, 'endpoint');
  assert.equal(extension.register, register);
  assert.equal(Object.isFrozen(extension), true);
  assert.equal(isYunCmsExtension(extension, 'endpoint'), true);
});

test('defineHook creates a hook definition', () => {
  const extension = defineHook(() => {});
  assert.equal(isYunCmsExtension(extension, 'hook'), true);
});

test('extension definitions reject non-function entrypoints', () => {
  assert.throws(() => defineEndpoint(null), /register function/);
  assert.throws(() => defineHook({}), /register function/);
});
