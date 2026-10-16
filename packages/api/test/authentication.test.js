import test from 'node:test';
import assert from 'node:assert/strict';

import { bearerToken, isPublicAuthRoute } from '../src/authentication.js';
import { requireSessionAuthentication, authActionRateKey } from '../src/routes/auth.js';

test('token confirmation and exchange rate keys ignore unrelated client identity fields', () => {
  for (const path of ['/password-reset/confirm', '/email-verification/confirm', '/exchange']) {
    for (const body of [{}, { email: 'arbitrary@example.test' }, { user: 'untrusted' }, { email: 'other@example.test', user: 'other' }]) {
      assert.equal(authActionRateKey({ ip: '127.0.0.1', route: { path }, body }), '127.0.0.1:');
    }
  }
});

test('recipient auth actions retain the actual email, native target user and route provider scopes', () => {
  for (const path of ['/register', '/password-reset/request']) {
    assert.equal(authActionRateKey({ ip: '127.0.0.1', route: { path }, body: { email: ' User@Example.Test ', user: 'ignored' } }), '127.0.0.1:user@example.test');
  }
  const path = '/email-verification/request';
  assert.equal(authActionRateKey({ ip: '127.0.0.1', route: { path }, body: { email: 'USER@EXAMPLE.TEST', user: 'ignored' } }), '127.0.0.1:user@example.test');
  assert.equal(authActionRateKey({ ip: '127.0.0.1', route: { path }, accountability: { user: 'native-caller' }, body: { email: 'ignored@example.test' } }), '127.0.0.1:native-caller');
  assert.equal(authActionRateKey({ ip: '127.0.0.1', route: { path }, accountability: { user: 'native-caller' }, body: { user: 'native-recipient', email: 'ignored@example.test' } }), '127.0.0.1:native-recipient');
  assert.equal(authActionRateKey({ socket: { remoteAddress: '127.0.0.2' }, route: { path: '/login/:provider' }, params: { provider: 'oidc' }, body: { email: 'ignored@example.test' } }), '127.0.0.2:oidc');
  assert.equal(authActionRateKey({ route: { path: '/register' }, body: { email: { toString: null } } }), 'unknown:');
});

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
