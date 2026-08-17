import test from 'node:test';
import assert from 'node:assert/strict';

import { createAccountability, createSystemAccountability } from '../src/accountability.js';
import { RolesService } from '../src/services/roles-service.js';

function createDatabase({ publicRole = null } = {}) {
  const calls = [];
  return {
    calls,
    async query(sql, params = []) {
      const normalized = sql.replace(/\s+/g, ' ').trim();
      calls.push({ sql: normalized, params });

      if (normalized === 'SELECT id FROM yuncms_roles WHERE public = 1 LIMIT 1') {
        return [publicRole ? [{ id: publicRole }] : [], []];
      }
      if (normalized.startsWith('INSERT INTO yuncms_roles')) return [{ affectedRows: 1 }, []];
      if (normalized.includes('FROM yuncms_roles') && normalized.includes('WHERE id = ?')) {
        return [[{
          id: params[0],
          name: 'Public',
          description: null,
          admin: 0,
          public: 1,
        }], []];
      }
      return [[], []];
    },
  };
}

test('normal users cannot manage roles', async () => {
  const database = createDatabase();
  const service = new RolesService({
    database,
    accountability: createAccountability({ user: 'user-1', role: 'role-1' }),
  });

  await assert.rejects(
    service.createOne({ name: 'Role' }),
    (error) => error.code === 'FORBIDDEN',
  );
  assert.equal(database.calls.length, 0);
});

test('a role cannot be both public and administrator', async () => {
  const database = createDatabase();
  const service = new RolesService({
    database,
    accountability: createSystemAccountability(),
  });

  await assert.rejects(
    service.createOne({ name: 'Unsafe', admin: true, public: true }),
    (error) => error.code === 'INVALID_ROLE',
  );
  assert.equal(database.calls.length, 0);
});

test('a second public role is rejected before insert', async () => {
  const database = createDatabase({ publicRole: 'public-role-1' });
  const service = new RolesService({
    database,
    accountability: createSystemAccountability(),
  });

  await assert.rejects(
    service.createOne({ name: 'Public 2', public: true }),
    (error) => error.code === 'PUBLIC_ROLE_EXISTS',
  );
  assert.equal(database.calls.some(({ sql }) => sql.startsWith('INSERT INTO yuncms_roles')), false);
});
