import assert from 'node:assert/strict';
import test from 'node:test';

import { createPublicAccountability } from '../src/accountability.js';
import { ensurePublicRole } from '../src/setup.js';
import { AuthService } from '../src/services/auth-service.js';
import { PermissionsService } from '../src/services/permissions-service.js';

function normalized(sql) {
  return sql.replace(/\s+/g, ' ').trim();
}

test('ensurePublicRole reuses an existing public role without writes', async () => {
  const calls = [];
  const database = {
    async query(sql, params = []) {
      calls.push({ sql: normalized(sql), params });
      if (sql.includes('WHERE public = 1')) {
        return [[{
          id: 'public-role',
          name: 'Public',
          description: 'Existing',
          admin: 0,
          public: 1,
        }], []];
      }
      throw new Error(`unexpected query: ${normalized(sql)}`);
    },
  };

  const role = await ensurePublicRole(database);
  assert.equal(role.id, 'public-role');
  assert.equal(role.created, false);
  assert.equal(calls.some(({ sql }) => sql.startsWith('INSERT INTO yuncms_roles')), false);
});

test('ensurePublicRole creates one protected role and grants no permissions', async () => {
  const calls = [];
  let createdRole = null;
  const database = {
    async query(sql, params = []) {
      const text = normalized(sql);
      calls.push({ sql: text, params });

      if (text.includes('FROM yuncms_roles') && text.includes('WHERE public = 1')) {
        return [createdRole ? [createdRole] : [], []];
      }
      if (text === 'SELECT id FROM yuncms_roles WHERE name = ? LIMIT 1') return [[], []];
      if (text.startsWith('INSERT INTO yuncms_roles')) {
        createdRole = {
          id: params[0],
          name: params[1],
          description: params[2],
          admin: params[3],
          public: params[4],
        };
        return [{ affectedRows: 1 }, []];
      }
      if (text.includes('FROM yuncms_roles') && text.includes('WHERE id = ?')) {
        return [[{
          ...createdRole,
          created_at: null,
          updated_at: null,
        }], []];
      }
      throw new Error(`unexpected query: ${text}`);
    },
  };

  const role = await ensurePublicRole(database);
  assert.equal(role.public, 1);
  assert.equal(role.admin, 0);
  assert.equal(role.created, true);
  assert.match(role.description, /No collection access is granted by default/);
  assert.equal(calls.some(({ sql }) => sql.includes('INSERT INTO yuncms_permissions')), false);
});

test('anonymous accountability resolves to the configured public role', async () => {
  const database = {
    async query(sql) {
      if (normalized(sql).includes('FROM yuncms_roles') && normalized(sql).includes('WHERE public = 1')) {
        return [[{ id: 'public-role' }], []];
      }
      throw new Error(`unexpected query: ${normalized(sql)}`);
    },
  };
  const auth = new AuthService({
    accountability: createPublicAccountability(),
    database,
  });

  const accountability = await auth.resolvePublicAccountability();
  assert.equal(accountability.public, true);
  assert.equal(accountability.role, 'public-role');
  assert.equal(accountability.admin, false);
});

test('public role is fail-closed until an explicit collection permission exists', async () => {
  const accountability = createPublicAccountability({ role: 'public-role' });
  const deniedDatabase = {
    async query(sql, params) {
      assert.match(normalized(sql), /FROM yuncms_permissions/);
      assert.deepEqual(params, ['public-role', 'articles', 'read']);
      return [[], []];
    },
  };

  await assert.rejects(
    new PermissionsService({ accountability, database: deniedDatabase }).resolve('read', 'articles'),
    (error) => error.code === 'FORBIDDEN',
  );

  const allowedDatabase = {
    async query(sql, params) {
      assert.match(normalized(sql), /FROM yuncms_permissions/);
      assert.deepEqual(params, ['public-role', 'articles', 'read']);
      return [[{
        id: 'permission-1',
        role: 'public-role',
        collection: 'articles',
        action: 'read',
        fields: '["id","title"]',
        filter: '{"status":{"_eq":"published"}}',
        validation: null,
      }], []];
    },
  };

  const permission = await new PermissionsService({ accountability, database: allowedDatabase })
    .resolve('read', 'articles');
  assert.equal(permission.fullAccess, false);
  assert.deepEqual(permission.fields, ['id', 'title']);
  assert.deepEqual(permission.filter, { status: { _eq: 'published' } });
});
