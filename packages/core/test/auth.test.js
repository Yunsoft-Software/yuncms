import test from 'node:test';
import assert from 'node:assert/strict';

import { createPublicAccountability } from '../src/accountability.js';
import { hashPassword, verifyPassword } from '../src/auth/password.js';
import { createOpaqueToken, hashToken, tokenType } from '../src/auth/tokens.js';
import { AuthService } from '../src/services/auth-service.js';
import { SessionsService } from '../src/services/sessions-service.js';

test('scrypt password hashes verify without storing the password', async () => {
  const encoded = await hashPassword('correct horse battery', {
    N: 1024,
    r: 8,
    p: 1,
    keyLength: 32,
    maxmem: 16 * 1024 * 1024,
  });

  assert.match(encoded, /^scrypt\$/);
  assert.equal(encoded.includes('correct horse battery'), false);
  assert.equal(await verifyPassword('correct horse battery', encoded), true);
  assert.equal(await verifyPassword('wrong password', encoded), false);
  assert.equal(await verifyPassword('anything', 'malformed'), false);
});

test('opaque tokens expose type prefixes but persist as hashes', () => {
  const access = createOpaqueToken('access');
  const refresh = createOpaqueToken('refresh', { bytes: 48 });

  assert.equal(tokenType(access.token), 'access');
  assert.equal(tokenType(refresh.token), 'refresh');
  assert.equal(hashToken(access.token), access.hash);
  assert.equal(access.hash.includes(access.token), false);
  assert.equal(access.hash.length, 64);
});

test('refresh rotation makes the old refresh token unusable and preserves the role name', async () => {
  const original = createOpaqueToken('refresh', { bytes: 48 });
  let storedRefreshHash = original.hash;
  const calls = [];
  const database = {
    async query(sql, params = []) {
      const normalized = sql.replace(/\s+/g, ' ').trim();
      calls.push({ sql: normalized, params });

      if (normalized.startsWith('SELECT s.id AS session_id') && normalized.includes('s.token_hash = ?')) {
        if (params[0] !== storedRefreshHash) return [[], []];
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
        const oldHash = params.at(-1);
        if (oldHash !== storedRefreshHash) return [{ affectedRows: 0 }, []];
        storedRefreshHash = params[0];
        return [{ affectedRows: 1 }, []];
      }

      throw new Error(`Unexpected query: ${normalized}`);
    },
  };
  const service = new SessionsService({
    accountability: createPublicAccountability(),
    database,
  });

  const rotated = await service.rotateRefreshToken(original.token, {
    now: new Date('2026-08-16T12:00:00Z'),
  });
  assert.equal(tokenType(rotated.access_token), 'access');
  assert.equal(tokenType(rotated.refresh_token), 'refresh');
  assert.equal(rotated.role_name, 'Content Editor');
  assert.equal(rotated.admin, false);
  assert.notEqual(rotated.refresh_token, original.token);

  await assert.rejects(
    service.rotateRefreshToken(original.token),
    (error) => error.code === 'INVALID_CREDENTIALS',
  );
});

test('login session user exposes the administrator flag required by Studio navigation', async () => {
  const encoded = await hashPassword('actual-password', {
    N: 1024,
    r: 8,
    p: 1,
    keyLength: 32,
    maxmem: 16 * 1024 * 1024,
  });
  const database = {
    async query(sql) {
      const normalized = sql.replace(/\s+/g, ' ').trim();
      if (normalized.startsWith('SELECT u.id, u.email, u.password_hash')) {
        return [[{
          id: 'admin-1',
          email: 'admin@example.com',
          password_hash: encoded,
          role: 'admin-role',
          role_name: 'Administrator',
          status: 'active',
          email_verified_at: new Date('2026-09-05T00:00:00.000Z'),
          role_admin: 1,
          role_public: 0,
        }], []];
      }
      if (normalized.startsWith('INSERT INTO yuncms_sessions')) return [{ affectedRows: 1 }, []];
      throw new Error(`Unexpected query: ${normalized}`);
    },
  };
  const service = new AuthService({
    accountability: createPublicAccountability(),
    database,
  });

  const result = await service.login({ email: 'admin@example.com', password: 'actual-password' });
  assert.equal(result.user.admin, true);
  assert.equal(result.user.role_name, 'Administrator');
});

test('login returns generic invalid credentials for wrong password', async () => {
  const encoded = await hashPassword('actual-password', {
    N: 1024,
    r: 8,
    p: 1,
    keyLength: 32,
    maxmem: 16 * 1024 * 1024,
  });
  const database = {
    async query(sql) {
      const normalized = sql.replace(/\s+/g, ' ').trim();
      if (normalized.startsWith('SELECT u.id, u.email, u.password_hash')) {
        return [[{
          id: 'user-1',
          email: 'user@example.com',
          password_hash: encoded,
          role: 'role-1',
          role_name: 'Content Editor',
          status: 'active',
          email_verified_at: null,
          role_admin: 0,
          role_public: 0,
        }], []];
      }
      throw new Error(`Unexpected query: ${normalized}`);
    },
  };
  const service = new AuthService({
    accountability: createPublicAccountability(),
    database,
  });

  await assert.rejects(
    service.login({ email: 'USER@example.com', password: 'wrong-password' }),
    (error) => error.code === 'INVALID_CREDENTIALS' && error.message === 'Invalid email or password',
  );
});

test('login rejects an unverified email when public registration verification is required', async () => {
  const encoded = await hashPassword('actual-password', {
    N: 1024,
    r: 8,
    p: 1,
    keyLength: 32,
    maxmem: 16 * 1024 * 1024,
  });
  let sessionQuery = false;
  const database = {
    async query(sql) {
      const normalized = sql.replace(/\s+/g, ' ').trim();
      if (normalized.startsWith('SELECT u.id, u.email, u.password_hash')) {
        return [[{
          id: 'user-unverified',
          email: 'unverified@example.com',
          password_hash: encoded,
          role: 'role-1',
          role_name: 'Content Editor',
          status: 'active',
          email_verified_at: null,
          role_admin: 0,
          role_public: 0,
        }], []];
      }
      if (normalized.startsWith('SELECT public_registration_require_email_verification')) {
        return [[{ public_registration_require_email_verification: 1 }], []];
      }
      if (normalized.includes('yuncms_sessions')) sessionQuery = true;
      throw new Error(`Unexpected query: ${normalized}`);
    },
  };
  const service = new AuthService({
    accountability: createPublicAccountability(),
    database,
  });

  await assert.rejects(
    service.login({ email: 'unverified@example.com', password: 'actual-password' }),
    (error) => error.code === 'EMAIL_NOT_VERIFIED',
  );
  assert.equal(sessionQuery, false);
});
