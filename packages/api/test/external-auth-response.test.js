import assert from 'node:assert/strict';
import test from 'node:test';
import express from 'express';
import { createExternalAuthState, createPublicAccountability, ExternalAuthService } from '@yunsoft/yuncms-core';
import { apiErrorHandler } from '../src/error-response.js';
import { ExternalAuthProviderRegistry } from '../src/external-auth/providers.js';
import { createAuthRouter } from '../src/routes/auth.js';

test('native OAuth callback rejects missing, malformed, expired and replayed states over HTTP without creating a session', async () => {
  const state = createExternalAuthState();
  let transaction = null;
  let sessionWrites = 0;
  let handoffs = 0;
  const database = {
    async getConnection() { return this; },
    async beginTransaction() {}, async commit() {}, async rollback() {}, release() {},
    async query(sql) {
      if (/INSERT INTO yuncms_sessions/.test(sql)) sessionWrites++;
      if (/FROM yuncms_auth_transactions/.test(sql)) return [transaction ? [transaction] : []];
      return [{ affectedRows: 0 }];
    },
  };
  const registry = new ExternalAuthProviderRegistry({
    config: { enabled: true, stateSecret: 's'.repeat(64), providers: [{ id: 'test', driver: 'oidc', label: 'Test' }] },
    database, publicUrl: 'http://localhost:3008', logger: { error() {} },
  });
  registry.createBrowserHandoff = async () => { handoffs++; throw new Error('must not create a handoff'); };
  const app = express();
  app.use((req, _res, next) => {
    req.id = 'oauth-regression';
    req.accountability = createPublicAccountability();
    req.context = { database, services: { ExternalAuthService }, logger: { error() {} } };
    next();
  });
  app.use('/auth', createAuthRouter({ externalAuthRegistry: registry, config: { auth: { rateLimit: { actionMax: 100 } } } }));
  app.use(apiErrorHandler({ error() {} }));
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  try {
    const origin = `http://127.0.0.1:${server.address().port}`;
    for (const kind of ['missing', 'malformed', 'unknown', 'expired', 'replayed']) {
      transaction = kind === 'expired' ? { expires_at: new Date(0), used_at: null }
        : kind === 'replayed' ? { expires_at: new Date(Date.now() + 60_000), used_at: new Date() } : null;
      const value = kind === 'missing' ? '' : kind === 'malformed' ? 'invalid-test' : state;
      const response = await fetch(`${origin}/auth/callback/test?state=${encodeURIComponent(value)}&code=test`, { redirect: 'manual' });
      const body = await response.json();
      assert.equal(response.status, 400, kind);
      assert.equal(body.errors[0].code, 'INVALID_AUTH_TRANSACTION', kind);
      assert.notEqual(body.errors[0].message, 'Internal server error', kind);
      assert.equal(response.headers.get('set-cookie'), null);
    }
    assert.equal(sessionWrites, 0);
    assert.equal(handoffs, 0);
  } finally { await new Promise(resolve => server.close(resolve)); }
});
