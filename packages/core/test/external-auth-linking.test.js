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
