import test from 'node:test';
import assert from 'node:assert/strict';

import { defineEndpoint, defineHook, isYunCmsExtension, ExtensionError, isExtensionError } from '../src/index.js';

test('extension business errors validate public codes, messages, paths and 4xx statuses', () => {
  for (const status of [400, 403, 409, 422, 429, 499]) {
    const cause = new Error('private cause');
    const error = new ExtensionError('BUSINESS_RULE_FAILED', 'Public reason', { status, path: 'status', cause });
    assert.equal(isExtensionError(error), true);
    assert.equal(error.status, status);
    assert.equal(error.path, 'status');
    assert.equal(error.cause, cause);
    assert.throws(() => { error.status = 500; }, TypeError);
  }
  assert.equal(new ExtensionError('BUSINESS_RULE_FAILED', 'Public reason').status, 400);
  for (const status of [200, 399, 500, '422', 422.5, NaN]) {
    assert.throws(() => new ExtensionError('BUSINESS_RULE_FAILED', 'Public reason', { status }), TypeError);
  }
  for (const code of ['', 'lowercase', 'INVALID-CODE', 'A'.repeat(65), null]) {
    assert.throws(() => new ExtensionError(code, 'Public reason'), TypeError);
  }
  for (const message of ['', ' ', null]) assert.throws(() => new ExtensionError('CUSTOM', message), TypeError);
  assert.throws(() => new ExtensionError('CUSTOM', 'Message', { path: 7 }), TypeError);
  assert.equal(isExtensionError(Object.assign(new Error('Private'), { status: 422, code: 'CUSTOM' })), false);
});

test('extension error recognition supports separately loaded SDK copies', async () => {
  const copy = await import(`../src/index.js?copy=${Date.now()}`);
  const error = new copy.ExtensionError('CUSTOM_REJECTION', 'Public reason', { status: 422 });
  assert.equal(error instanceof ExtensionError, false);
  assert.equal(isExtensionError(error), true);
});

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
