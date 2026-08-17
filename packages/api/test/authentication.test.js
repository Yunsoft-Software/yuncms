import test from 'node:test';
import assert from 'node:assert/strict';

import { bearerToken, isPublicAuthRoute } from '../src/authentication.js';
import { requireSessionAuthentication } from '../src/routes/auth.js';

test('bearer parser accepts one opaque credential only', () => {
  assert.equal(bearerToken('Bearer yca_example'), 'yca_example');
  assert.equal(bearerToken(null), null);
  assert.throws(
    () => bearerToken('Basic abc'),
    (error) => error.code === 'INVALID_CREDENTIALS',
  );
  assert.throws(
    () => bearerToken('Bearer token with spaces'),
    (error) => error.code === 'INVALID_CREDENTIALS',
  );
});

test('only login and refresh bypass public role resolution', () => {
  assert.equal(isPublicAuthRoute({ method: 'POST', path: '/auth/login' }), true);
  assert.equal(isPublicAuthRoute({ method: 'POST', path: '/auth/refresh' }), true);
  assert.equal(isPublicAuthRoute({ method: 'GET', path: '/auth/tokens' }), false);
  assert.equal(isPublicAuthRoute({ method: 'POST', path: '/auth/logout' }), false);
});

test('session logout rejects public and api token authentication methods', () => {
  assert.doesNotThrow(() => requireSessionAuthentication({
    authMethod: 'session',
    authToken: 'yca_access',
  }));

  assert.throws(
    () => requireSessionAuthentication({ authMethod: 'api_token', authToken: 'yct_api' }),
    (error) => error.code === 'UNAUTHORIZED',
  );
  assert.throws(
    () => requireSessionAuthentication({ authMethod: 'public', authToken: null }),
    (error) => error.code === 'UNAUTHORIZED',
  );
});
