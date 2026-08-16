import test from 'node:test';
import assert from 'node:assert/strict';

import { createAccountability } from '../src/accountability.js';
import { tokenType } from '../src/auth/tokens.js';
import { ApiTokensService } from '../src/services/api-tokens-service.js';

function createDatabase() {
  const calls = [];
  let inserted = null;

  return {
    calls,
    get inserted() { return inserted; },
    async query(sql, params = []) {
      const normalized = sql.replace(/\s+/g, ' ').trim();
      calls.push({ sql: normalized, params });

      if (normalized.startsWith("SELECT id FROM yuncms_users WHERE id = ? AND status = 'active'")) {
        return [[{ id: params[0] }], []];
      }
      if (normalized.startsWith('INSERT INTO yuncms_api_tokens')) {
        inserted = {
          id: params[0],
          user: params[1],
          name: params[2],
          tokenHash: params[3],
          expiresAt: params[4],
        };
        return [{ affectedRows: 1 }, []];
      }
      if (normalized.startsWith('SELECT id, user, name, expires_at')) {
        return [[{
          id: inserted?.id ?? 'token-1',
          user: params[0],
          name: inserted?.name ?? 'CLI',
          expires_at: inserted?.expiresAt ?? null,
          last_used_at: null,
          created_at: new Date('2026-08-16T12:00:00Z'),
        }], []];
      }
      return [{ affectedRows: 1 }, []];
    },
  };
}

test('api token secret is returned once while database receives only hash', async () => {
  const database = createDatabase();
  const service = new ApiTokensService({
    database,
    accountability: createAccountability({ user: 'user-1', role: 'role-1' }),
  });

  const created = await service.createOne({ name: 'CLI' });
  assert.equal(tokenType(created.token), 'api');
  assert.equal(database.inserted.tokenHash.length, 64);
  assert.equal(database.inserted.tokenHash.includes(created.token), false);

  const listed = await service.readMany();
  assert.equal(Object.hasOwn(listed[0], 'token'), false);
  assert.equal(Object.hasOwn(listed[0], 'token_hash'), false);
});

test('normal users cannot create api tokens for another user', async () => {
  const database = createDatabase();
  const service = new ApiTokensService({
    database,
    accountability: createAccountability({ user: 'user-1', role: 'role-1' }),
  });

  await assert.rejects(
    service.createOne({ name: 'Other', user: 'user-2' }),
    (error) => error.code === 'FORBIDDEN',
  );
  assert.equal(database.calls.length, 0);
});
