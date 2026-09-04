import assert from 'node:assert/strict';
import test from 'node:test';

import { ExternalAuthService } from '../src/services/external-auth-service.js';

test('external auth defaults do not allow unlinked identities', async () => {
  const service = new ExternalAuthService({
    accountability: { user: null, role: null, admin: false, public: true },
    database: { async query(sql) { if (sql.includes('FROM yuncms_auth_identities')) return [[]]; throw new Error(`unexpected query: ${sql}`); } },
    stateSecret: '0123456789abcdef0123456789abcdef',
  });
  await assert.rejects(() => service.completeLogin({
    provider: 'company', subject: 'subject-1', email: 'user@example.test', emailVerified: true,
  }), (error) => error.code === 'EXTERNAL_IDENTITY_NOT_LINKED');
});

test('external login exposes administrator state in the Studio session', async () => {
  const database = {
    async query(sql) {
      const normalized = sql.replace(/\s+/g, ' ').trim();
      if (normalized.includes('FROM yuncms_auth_identities i')) {
        return [[{
          identity_id: 'identity-1',
          provider: 'company',
          subject: 'subject-1',
          user: 'admin-1',
          id: 'admin-1',
          email: 'admin@example.test',
          role: 'admin-role',
          role_name: 'Administrator',
          role_admin: 1,
          role_public: 0,
          status: 'active',
          email_verified_at: new Date('2026-09-05T00:00:00.000Z'),
        }], []];
      }
      if (normalized.startsWith('UPDATE yuncms_auth_identities')) return [{ affectedRows: 1 }, []];
      if (normalized.startsWith('INSERT INTO yuncms_sessions')) return [{ affectedRows: 1 }, []];
      throw new Error(`unexpected query: ${normalized}`);
    },
  };
  const service = new ExternalAuthService({
    accountability: { user: null, role: null, admin: false, public: true },
    database,
    stateSecret: '0123456789abcdef0123456789abcdef',
  });

  const result = await service.completeLogin({ provider: 'company', subject: 'subject-1' });
  assert.equal(result.user.admin, true);
  assert.equal(result.user.role_name, 'Administrator');
});
