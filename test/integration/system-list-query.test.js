import assert from 'node:assert/strict';
import test from 'node:test';

import {
  bootstrapDatabase,
  closeDatabasePool,
  createAccountability,
  createDatabasePool,
  createSystemAccountability,
  loadConfig,
  PermissionsService,
  RolesService,
  UsersService,
} from '@yunsoft/yuncms-core';

const ENABLED = process.env.YUNCMS_TEST_MYSQL === '1';
const DESTRUCTIVE = process.env.YUNCMS_TEST_DB_ALLOW_DESTRUCTIVE === '1';

function suffix() {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`.slice(-10);
}

function requireDisposableDatabase(config) {
  if (!DESTRUCTIVE) {
    throw new Error('YUNCMS_TEST_DB_ALLOW_DESTRUCTIVE=1 is required for integration tests');
  }
  if (!/(test|ci|dev)/i.test(config.database.database)) {
    throw new Error(`Integration DB name must contain test, ci or dev: ${config.database.database}`);
  }
}

test('real MySQL integration for bounded users and roles list queries', {
  skip: !ENABLED,
  timeout: 60_000,
}, async () => {
  const config = loadConfig(process.env);
  requireDisposableDatabase(config);
  const pool = createDatabasePool(config.database);
  await bootstrapDatabase(pool);
  const system = createSystemAccountability();
  const token = suffix();

  const usersService = new UsersService({ database: pool, accountability: system });
  const rolesService = new RolesService({ database: pool, accountability: system });
  const permissionsService = new PermissionsService({ database: pool, accountability: system });

  const createdUserIds = [];
  const createdRoleIds = [];
  const createdPermissionIds = [];

  try {
    // 1. Create at least 5 role fixtures
    const rolePrefix = `it_role_${token}`;
    for (let i = 1; i <= 5; i++) {
      const role = await rolesService.createOne({
        name: `${rolePrefix}_${String(i).padStart(2, '0')}`,
        description: `Description for role ${i} of token ${token}`,
      });
      createdRoleIds.push(role.id);
    }

    // 2. Create at least 5 user fixtures
    const userEmailPrefix = `it_user_${token}`;
    for (let i = 1; i <= 5; i++) {
      const user = await usersService.createOne({
        email: `${userEmailPrefix}_${String(i).padStart(2, '0')}@example.test`,
        password: `TestPassword${i}!123`,
        role: createdRoleIds[i - 1],
        status: 'active',
      });
      createdUserIds.push(user.id);
    }

    // 3. Test empty query (unbounded mode) returns created items
    const unboundedUsers = await usersService.readMany({});
    assert.ok(unboundedUsers.length >= 5);
    const unboundedRoles = await rolesService.readMany();
    assert.ok(unboundedRoles.length >= 5);

    // 4. Test safe outputs (no password_hash, tokens, secrets)
    for (const u of unboundedUsers) {
      assert.equal('password_hash' in u, false, 'Users list must never expose password_hash');
      assert.equal('token' in u, false, 'Users list must never expose token');
    }

    // 5. Distinct limit=1 / offset=1 pages for Users
    const userPage1 = await usersService.readMany({ limit: 1, offset: 0, search: userEmailPrefix });
    const userPage2 = await usersService.readMany({ limit: 1, offset: 1, search: userEmailPrefix });
    assert.equal(userPage1.length, 1, 'Page 1 should return 1 user');
    assert.equal(userPage2.length, 1, 'Page 2 should return 1 user');
    assert.notEqual(userPage1[0].id, userPage2[0].id, 'Pages must return distinct users');
    assert.ok(userPage1[0].email < userPage2[0].email, 'Users must be ordered by email ASC');

    // 6. Distinct limit=1 / offset=1 pages for Roles
    const rolePage1 = await rolesService.readMany({ limit: 1, offset: 0, search: rolePrefix });
    const rolePage2 = await rolesService.readMany({ limit: 1, offset: 1, search: rolePrefix });
    assert.equal(rolePage1.length, 1, 'Page 1 should return 1 role');
    assert.equal(rolePage2.length, 1, 'Page 2 should return 1 role');
    assert.notEqual(rolePage1[0].id, rolePage2[0].id, 'Pages must return distinct roles');
    assert.ok(rolePage1[0].name < rolePage2[0].name, 'Roles must be ordered by name ASC');

    // 7. Bounded search for Users (email only)
    const specificUserSearch = await usersService.readMany({
      search: `${userEmailPrefix}_03`,
      limit: 10,
    });
    assert.equal(specificUserSearch.length, 1);
    assert.equal(specificUserSearch[0].id, createdUserIds[2]);

    // 8. Bounded search for Roles (name and description)
    const searchByName = await rolesService.readMany({
      search: `${rolePrefix}_04`,
      limit: 10,
    });
    assert.equal(searchByName.length, 1);
    assert.equal(searchByName[0].id, createdRoleIds[3]);

    const searchByDesc = await rolesService.readMany({
      search: `Description for role 5 of token ${token}`,
      limit: 10,
    });
    assert.equal(searchByDesc.length, 1);
    assert.equal(searchByDesc[0].id, createdRoleIds[4]);

    // Non-matching search returns empty array
    const emptySearch = await usersService.readMany({
      search: `nonexistent_${token}`,
      limit: 10,
    });
    assert.equal(emptySearch.length, 0);

    // 9. Delegated role without read permission is denied
    const deniedRole = await rolesService.createOne({
      name: `it_denied_${token}`,
      description: 'Role with no read grants',
    });
    createdRoleIds.push(deniedRole.id);

    const deniedAccountability = createAccountability({
      user: createdUserIds[0],
      role: deniedRole.id,
    });
    const deniedUsersService = new UsersService({
      database: pool,
      accountability: deniedAccountability,
    });
    const deniedRolesService = new RolesService({
      database: pool,
      accountability: deniedAccountability,
    });

    await assert.rejects(
      deniedUsersService.readMany({ limit: 10 }),
      (err) => err.code === 'FORBIDDEN',
      'User read without permission must be rejected with FORBIDDEN',
    );
    await assert.rejects(
      deniedRolesService.readMany({ limit: 10 }),
      (err) => err.code === 'FORBIDDEN',
      'Role read without permission must be rejected with FORBIDDEN',
    );

    // 10. Delegated role with read permission succeeds
    const userReadPerm = await permissionsService.createOne({
      role: deniedRole.id,
      collection: 'yuncms_users',
      action: 'read',
    });
    createdPermissionIds.push(userReadPerm.id);

    const permittedUsers = await deniedUsersService.readMany({
      search: userEmailPrefix,
      limit: 5,
    });
    assert.ok(permittedUsers.length >= 1, 'Delegated role with grant should read users');
  } finally {
    const cleanupErrors = [];

    // Delete permissions first
    for (const permId of createdPermissionIds) {
      try {
        await permissionsService.deleteOne(permId);
      } catch (err) {
        cleanupErrors.push(err);
      }
    }

    // Delete users before roles to respect foreign key constraints
    for (const userId of createdUserIds) {
      try {
        await usersService.deleteOne(userId);
      } catch (err) {
        cleanupErrors.push(err);
      }
    }

    // Delete roles last
    for (const roleId of createdRoleIds) {
      try {
        await rolesService.deleteOne(roleId);
      } catch (err) {
        cleanupErrors.push(err);
      }
    }

    await closeDatabasePool(pool);

    if (cleanupErrors.length > 0) {
      throw new Error(
        `Cleanup failed with ${cleanupErrors.length} error(s): ${cleanupErrors.map((e) => e.message).join('; ')}`,
      );
    }
  }
});
