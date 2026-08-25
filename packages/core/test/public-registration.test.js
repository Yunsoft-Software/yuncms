import assert from 'node:assert/strict';
import test from 'node:test';

import { createAccountability, createPublicAccountability } from '../src/accountability.js';
import { UsersService } from '../src/services/users-service.js';

const REGISTRATION_ROLE_ID = '323e4567-e89b-42d3-a456-426614174002';

test('public registration fails closed while disabled', async () => {
  let inserted = false;
  const database = {
    async query(sql) {
      if (sql.includes('FROM yuncms_studio_settings')) {
        return [[{
          public_registration_enabled: 0,
          public_registration_role: REGISTRATION_ROLE_ID,
          public_registration_require_email_verification: 0,
        }], []];
      }
      if (sql.includes('INSERT INTO yuncms_users')) inserted = true;
      throw new Error(`Unexpected query: ${sql}`);
    },
  };
  const service = new UsersService({
    database,
    accountability: createPublicAccountability({ role: 'public-role' }),
  });

  await assert.rejects(
    service.registerPublic({ email: 'new@example.com', password: 'long-enough-password' }),
    (error) => error.code === 'FORBIDDEN' && /disabled/.test(error.message),
  );
  assert.equal(inserted, false);
});

test('public registration assigns only the configured normal role and verifies immediately by default', async () => {
  let inserted = null;
  const database = {
    async query(sql, params = []) {
      const normalized = sql.replace(/\s+/g, ' ').trim();
      if (normalized.includes('FROM yuncms_studio_settings')) {
        return [[{
          public_registration_enabled: 1,
          public_registration_role: REGISTRATION_ROLE_ID,
          public_registration_require_email_verification: 0,
        }], []];
      }
      if (normalized.startsWith('SELECT id, admin, public FROM yuncms_roles')) {
        assert.deepEqual(params, [REGISTRATION_ROLE_ID]);
        return [[{ id: REGISTRATION_ROLE_ID, admin: 0, public: 0 }], []];
      }
      if (normalized.startsWith('INSERT INTO yuncms_users')) {
        inserted = params;
        return [{ affectedRows: 1 }, []];
      }
      if (normalized.startsWith('SELECT id, email, role, status')) {
        return [[{
          id: inserted[0],
          email: inserted[1],
          role: inserted[3],
          status: 'active',
          email_verified_at: inserted[4],
        }], []];
      }
      throw new Error(`Unexpected query: ${normalized}`);
    },
  };
  const service = new UsersService({
    database,
    accountability: createPublicAccountability({ role: 'public-role' }),
  });

  const user = await service.registerPublic({
    email: '  New@Example.com ',
    password: 'long-enough-password',
  });

  assert.ok(inserted);
  assert.equal(inserted[1], 'new@example.com');
  assert.equal(inserted[3], REGISTRATION_ROLE_ID);
  assert.ok(inserted[4] instanceof Date);
  assert.equal(user.role, REGISTRATION_ROLE_ID);
});

test('public registration leaves email unverified when verification is required', async () => {
  let inserted = null;
  const database = {
    async query(sql, params = []) {
      const normalized = sql.replace(/\s+/g, ' ').trim();
      if (normalized.includes('FROM yuncms_studio_settings')) {
        return [[{
          public_registration_enabled: 1,
          public_registration_role: REGISTRATION_ROLE_ID,
          public_registration_require_email_verification: 1,
        }], []];
      }
      if (normalized.startsWith('SELECT id, admin, public FROM yuncms_roles')) {
        return [[{ id: REGISTRATION_ROLE_ID, admin: 0, public: 0 }], []];
      }
      if (normalized.startsWith('INSERT INTO yuncms_users')) {
        inserted = params;
        return [{ affectedRows: 1 }, []];
      }
      if (normalized.startsWith('SELECT id, email, role, status')) {
        return [[{
          id: inserted[0],
          email: inserted[1],
          role: inserted[3],
          status: 'active',
          email_verified_at: inserted[4],
        }], []];
      }
      throw new Error(`Unexpected query: ${normalized}`);
    },
  };
  const service = new UsersService({
    database,
    accountability: createPublicAccountability(),
  });

  const user = await service.registerPublic({
    email: 'verify-me@example.com',
    password: 'long-enough-password',
  });

  assert.ok(inserted);
  assert.equal(inserted[4], null);
  assert.equal(user.email_verified_at, null);
});

test('authenticated requests cannot use public registration', async () => {
  const database = {
    async query() {
      throw new Error('database must not be touched');
    },
  };
  const service = new UsersService({
    database,
    accountability: createAccountability({ user: 'user-1', role: 'role-1' }),
  });

  await assert.rejects(
    service.registerPublic({ email: 'new@example.com', password: 'long-enough-password' }),
    (error) => error.code === 'FORBIDDEN',
  );
});

test('public registration rejects client-controlled role or status fields', async () => {
  const database = {
    async query(sql) {
      if (sql.includes('FROM yuncms_studio_settings')) {
        return [[{
          public_registration_enabled: 1,
          public_registration_role: REGISTRATION_ROLE_ID,
          public_registration_require_email_verification: 0,
        }], []];
      }
      if (sql.includes('FROM yuncms_roles')) {
        return [[{ id: REGISTRATION_ROLE_ID, admin: 0, public: 0 }], []];
      }
      throw new Error(`Unexpected query: ${sql}`);
    },
  };
  const service = new UsersService({
    database,
    accountability: createPublicAccountability(),
  });

  await assert.rejects(
    service.registerPublic({
      email: 'new@example.com',
      password: 'long-enough-password',
      role: 'admin-role',
    }),
    (error) => error.code === 'INVALID_PAYLOAD',
  );
});
