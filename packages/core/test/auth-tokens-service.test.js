import assert from 'node:assert/strict';
import test from 'node:test';

import { createPublicAccountability, createSystemAccountability } from '../src/accountability.js';
import { AuthTokensService } from '../src/services/auth-tokens-service.js';

test('password reset request hides malformed email as a non-match', async () => {
  const service = new AuthTokensService({
    accountability: createPublicAccountability(),
    database: {
      query() {
        throw new Error('database should not be queried for malformed email');
      },
    },
  });

  assert.equal(await service.requestPasswordReset('not-an-email'), null);
});

test('password reset rejects tokens of the wrong type before database access', async () => {
  const service = new AuthTokensService({
    accountability: createPublicAccountability(),
    database: {
      getConnection() {
        throw new Error('database should not be opened for wrong token type');
      },
    },
  });

  await assert.rejects(
    service.resetPassword('ycv_wrong-token-type', 'A-secure-new-password-123'),
    (error) => error.code === 'INVALID_TOKEN',
  );
});

test('email verification issuance is limited to self, admin or system', async () => {
  const service = new AuthTokensService({
    accountability: {
      user: '11111111-1111-1111-1111-111111111111',
      role: null,
      admin: false,
      public: false,
      system: false,
    },
    database: {},
  });

  await assert.rejects(
    service.createEmailVerification('22222222-2222-2222-2222-222222222222'),
    (error) => error.code === 'FORBIDDEN',
  );
});

test('public callers cannot look up accounts for verification resend', async () => {
  const service = new AuthTokensService({
    accountability: createPublicAccountability(),
    database: {
      query() {
        throw new Error('database must not be touched');
      },
    },
  });

  await assert.rejects(
    service.requestEmailVerification('person@example.com'),
    (error) => error.code === 'FORBIDDEN',
  );
});

test('system verification resend creates a replacement token only for an active unverified account', async () => {
  const connectionCalls = [];
  const connection = {
    async beginTransaction() { connectionCalls.push('begin'); },
    async commit() { connectionCalls.push('commit'); },
    async rollback() { connectionCalls.push('rollback'); },
    release() { connectionCalls.push('release'); },
    async query(sql, params = []) {
      const normalized = sql.replace(/\s+/g, ' ').trim();
      connectionCalls.push({ sql: normalized, params });
      if (normalized.startsWith('DELETE FROM yuncms_auth_tokens')) return [{ affectedRows: 1 }, []];
      if (normalized.startsWith('INSERT INTO yuncms_auth_tokens')) return [{ affectedRows: 1 }, []];
      throw new Error(`Unexpected connection query: ${normalized}`);
    },
  };
  const database = {
    async query(sql, params = []) {
      const normalized = sql.replace(/\s+/g, ' ').trim();
      if (normalized.startsWith('SELECT u.id, u.email, u.password_hash')) {
        assert.deepEqual(params, ['person@example.com']);
        return [[{
          id: '11111111-1111-4111-8111-111111111111',
          email: 'person@example.com',
          password_hash: null,
          role: 'role-1',
          status: 'active',
          email_verified_at: null,
          role_name: 'Member',
          role_admin: 0,
          role_public: 0,
        }], []];
      }
      if (normalized.startsWith('SELECT id, status FROM yuncms_users')) {
        return [[{ id: params[0], status: 'active' }], []];
      }
      throw new Error(`Unexpected query: ${normalized}`);
    },
    async getConnection() {
      return connection;
    },
  };
  const service = new AuthTokensService({
    accountability: createSystemAccountability(),
    database,
  });

  const result = await service.requestEmailVerification(' Person@Example.com ');
  assert.equal(result.user.email, 'person@example.com');
  assert.match(result.token, /^ycv_/);
  assert.equal(connectionCalls.includes('commit'), true);
  assert.equal(connectionCalls.includes('release'), true);
});
