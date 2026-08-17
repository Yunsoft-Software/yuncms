import assert from 'node:assert/strict';
import test from 'node:test';

import { createPublicAccountability } from '../src/accountability.js';
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
