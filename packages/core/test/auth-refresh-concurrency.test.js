import assert from 'node:assert/strict';
import test from 'node:test';

import { createPublicAccountability } from '../src/accountability.js';
import { createOpaqueToken, hashToken, tokenType } from '../src/auth/tokens.js';
import { SessionsService } from '../src/services/sessions-service.js';

function createBarrier(count) {
  let arrived = 0;
  let unblock;
  const promise = new Promise((resolve) => {
    unblock = resolve;
  });
  return {
    reach() {
      arrived += 1;
      if (arrived >= count) {
        unblock();
      }
    },
    wait() {
      return promise;
    },
  };
}

test('concurrent rotateRefreshToken calls with deterministic barrier: exactly one winner and one invalidation rejection', { timeout: 5000 }, async () => {
  const original = createOpaqueToken('refresh', { bytes: 48 });
  let currentRefreshHash = original.hash;
  let currentAccessHash = null;

  const selectBarrier = createBarrier(2);
  const selectQueries = [];
  const updateQueries = [];

  const database = {
    async query(sql, params = []) {
      const normalized = sql.replace(/\s+/g, ' ').trim();

      if (normalized.startsWith('SELECT s.id AS session_id')) {
        selectQueries.push({ sql: normalized, params });
        const queriedHash = params[0];
        if (queriedHash !== currentRefreshHash) {
          return [[], []];
        }
        selectBarrier.reach();
        return [[{
          session_id: 'session-1',
          user: 'user-1',
          email: 'user@example.com',
          role: 'role-1',
          role_name: 'Administrator',
          status: 'active',
          role_admin: 1,
        }], []];
      }

      if (normalized.startsWith('UPDATE yuncms_sessions SET token_hash')) {
        updateQueries.push({ sql: normalized, params });
        assert.ok(
          normalized.includes('WHERE id = ? AND token_hash = ?'),
          'UPDATE must enforce WHERE id = ? AND token_hash = ?',
        );
        assert.equal(params.at(-2), 'session-1', 'Target session ID must match session-1');

        // Deterministic synchronization: neither UPDATE proceeds until both SELECTs have completed
        await selectBarrier.wait();

        const newRefreshHash = params[0];
        const newAccessHash = params[1];
        const oldHash = params.at(-1);

        if (oldHash === currentRefreshHash) {
          currentRefreshHash = newRefreshHash;
          currentAccessHash = newAccessHash;
          return [{ affectedRows: 1 }, []];
        }
        return [{ affectedRows: 0 }, []];
      }

      throw new Error(`Unexpected query: ${normalized}`);
    },
  };

  const service = new SessionsService({
    accountability: createPublicAccountability(),
    database,
  });

  const results = await Promise.allSettled([
    service.rotateRefreshToken(original.token),
    service.rotateRefreshToken(original.token),
  ]);

  const fulfilled = results.filter((r) => r.status === 'fulfilled');
  const rejected = results.filter((r) => r.status === 'rejected');

  assert.equal(fulfilled.length, 1, 'Exactly one concurrent rotation must succeed');
  assert.equal(rejected.length, 1, 'The competing concurrent rotation must be rejected');

  // Verify rejection reason
  const rejection = rejected[0].reason;
  assert.equal(rejection.code, 'INVALID_CREDENTIALS');

  // Verify winner identity and tokens
  const winner = fulfilled[0].value;
  assert.equal(winner.user, 'user-1');
  assert.equal(winner.role, 'role-1');
  assert.equal(winner.role_name, 'Administrator');
  assert.equal(winner.admin, true);
  assert.equal(winner.email, 'user@example.com');
  assert.equal(winner.session, 'session-1');
  assert.equal(winner.authMethod, 'session');

  assert.equal(tokenType(winner.access_token), 'access');
  assert.equal(tokenType(winner.refresh_token), 'refresh');
  assert.notEqual(winner.refresh_token, original.token);

  // Verify winning tokens match the updated hashes in the fake database
  assert.equal(hashToken(winner.refresh_token), currentRefreshHash);
  assert.equal(hashToken(winner.access_token), currentAccessHash);

  // Both SELECTs occurred before any UPDATE completed
  assert.equal(selectQueries.length, 2);
  assert.equal(updateQueries.length, 2);

  // Verify replay rejection with old refresh token
  await assert.rejects(
    service.rotateRefreshToken(original.token),
    (error) => error.code === 'INVALID_CREDENTIALS',
  );
});

test('rotateRefreshToken rejects when refresh token hash is not found in database (empty SELECT)', async () => {
  const database = {
    async query(sql) {
      const normalized = sql.replace(/\s+/g, ' ').trim();
      if (normalized.startsWith('SELECT s.id AS session_id')) {
        return [[], []];
      }
      throw new Error(`Unexpected query: ${normalized}`);
    },
  };

  const service = new SessionsService({
    accountability: createPublicAccountability(),
    database,
  });

  const unknownToken = createOpaqueToken('refresh', { bytes: 48 }).token;
  await assert.rejects(
    service.rotateRefreshToken(unknownToken),
    (error) => error.code === 'INVALID_CREDENTIALS',
  );
});

test('rotateRefreshToken rejects when conditional update matches zero rows (affectedRows = 0)', async () => {
  const token = createOpaqueToken('refresh', { bytes: 48 });

  const database = {
    async query(sql) {
      const normalized = sql.replace(/\s+/g, ' ').trim();
      if (normalized.startsWith('SELECT s.id AS session_id')) {
        return [[{
          session_id: 'session-1',
          user: 'user-1',
          email: 'user@example.com',
          role: 'role-1',
          role_name: 'Content Editor',
          status: 'active',
          role_admin: 0,
        }], []];
      }
      if (normalized.startsWith('UPDATE yuncms_sessions SET token_hash')) {
        return [{ affectedRows: 0 }, []];
      }
      throw new Error(`Unexpected query: ${normalized}`);
    },
  };

  const service = new SessionsService({
    accountability: createPublicAccountability(),
    database,
  });

  await assert.rejects(
    service.rotateRefreshToken(token.token),
    (error) => error.code === 'INVALID_CREDENTIALS',
  );
});
