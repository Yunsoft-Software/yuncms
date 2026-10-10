import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';

import {
  applyMigrations,
  assertDatabaseCompatible,
  bootstrapDatabase,
  closeDatabasePool,
  CORE_MIGRATIONS,
  createDatabasePool,
  createSystemAccountability,
  loadConfig,
  PermissionsService,
  quoteIdentifier,
  RolesService,
  UsersService,
} from '@yunsoft/yuncms-core';
import { resetDatabaseObjects } from '../../packages/cli/src/database-reset.js';
import { SessionsService } from '../../packages/core/src/services/sessions-service.js';

const MYSQL_ENABLED = process.env.YUNCMS_TEST_MYSQL === '1';
const MIGRATION_ENABLED = process.env.YUNCMS_TEST_MIGRATION === '1';
const DESTRUCTIVE = process.env.YUNCMS_TEST_DB_ALLOW_DESTRUCTIVE === '1';
const ENABLED = MYSQL_ENABLED && MIGRATION_ENABLED;

function migrationEnv() {
  const database = process.env.YUNCMS_MIGRATION_TEST_DB_DATABASE;
  if (!DESTRUCTIVE) throw new Error('YUNCMS_TEST_DB_ALLOW_DESTRUCTIVE=1 is required');
  if (!database || !/(test|ci|dev)/i.test(database)) {
    throw new Error(`YUNCMS_MIGRATION_TEST_DB_DATABASE must name a disposable test/ci/dev database: ${database}`);
  }
  return { ...process.env, DB_DATABASE: database };
}

async function countById(pool, table, id) {
  const tableSql = quoteIdentifier(table, 'integration table name');
  const [rows] = await pool.query(`SELECT COUNT(*) AS count FROM ${tableSql} WHERE id = ?`, [id]);
  return Number(rows[0]?.count ?? 0);
}

test('0022 UTC migration revokes legacy sessions/action-tokens/transactions/finite-api-tokens, preserves identities/roles/users/nonexpiring tokens, and rerun preserves new sessions', {
  skip: !ENABLED,
  timeout: 90_000,
}, async () => {
  const config = loadConfig(migrationEnv());
  let pool = null;

  try {
    await resetDatabaseObjects({ config: config.database });
    pool = createDatabasePool(config.database);

    // Apply all migrations up to 0021 (everything before 0022-utc-auth-deadlines)
    const migration0022Index = CORE_MIGRATIONS.findIndex(({ id }) => id === '0022-utc-auth-deadlines');
    assert.notEqual(migration0022Index, -1, '0022-utc-auth-deadlines must be present in CORE_MIGRATIONS');
    const pre0022Migrations = CORE_MIGRATIONS.slice(0, migration0022Index);

    const preUpgrade = await applyMigrations(pool, pre0022Migrations);
    assert.deepEqual(preUpgrade.newlyApplied, pre0022Migrations.map((m) => m.id));

    const system = createSystemAccountability();
    const roles = new RolesService({ accountability: system, database: pool });
    const users = new UsersService({ accountability: system, database: pool });
    const permissions = new PermissionsService({ accountability: system, database: pool });

    // 1. Synthetic persistent resources
    const role = await roles.createOne({ name: `UTC Migration Role ${randomUUID()}` });
    const user = await users.createOne({
      email: `utc-mig-${randomUUID()}@example.test`,
      password: 'Utc-Migration-Pass-1!',
      role: role.id,
      status: 'active',
      emailVerified: true,
    });
    const permission = await permissions.createOne({
      role: role.id,
      collection: 'yuncms_files',
      action: 'read',
    });

    const identityId = randomUUID();
    await pool.query(
      `INSERT INTO yuncms_auth_identities (id, provider, subject, user)
       VALUES (?, ?, ?, ?)`,
      [identityId, 'google', `google-sub-${randomUUID()}`, user.id],
    );

    const nonExpiringApiTokenId = randomUUID();
    await pool.query(
      `INSERT INTO yuncms_api_tokens (id, user, name, token_hash, expires_at)
       VALUES (?, ?, ?, ?, NULL)`,
      [nonExpiringApiTokenId, user.id, 'Permanent CI Token', `hash-perm-${randomUUID()}`],
    );

    // 2. Synthetic legacy resources that must be revoked by 0022
    const sessions = new SessionsService({ accountability: system, database: pool });
    const legacySession = await sessions.createForUser(user);

    const actionTokenId = randomUUID();
    await pool.query(
      `INSERT INTO yuncms_auth_tokens (id, user, type, token_hash, expires_at)
       VALUES (?, ?, ?, ?, DATE_ADD(CURRENT_TIMESTAMP(3), INTERVAL 1 HOUR))`,
      [actionTokenId, user.id, 'password-reset', `action-hash-${randomUUID()}`],
    );

    const transactionId = randomUUID();
    await pool.query(
      `INSERT INTO yuncms_auth_transactions (id, provider, state_hash, expires_at)
       VALUES (?, ?, ?, DATE_ADD(CURRENT_TIMESTAMP(3), INTERVAL 10 MINUTE))`,
      [transactionId, 'google', `state-hash-${randomUUID()}`],
    );

    const finiteApiTokenId = randomUUID();
    await pool.query(
      `INSERT INTO yuncms_api_tokens (id, user, name, token_hash, expires_at)
       VALUES (?, ?, ?, ?, DATE_ADD(CURRENT_TIMESTAMP(3), INTERVAL 30 DAY))`,
      [finiteApiTokenId, user.id, 'Expiring Dev Token', `hash-finite-${randomUUID()}`],
    );

    // Verify all fixtures exist prior to upgrade
    assert.equal(await countById(pool, 'yuncms_roles', role.id), 1);
    assert.equal(await countById(pool, 'yuncms_users', user.id), 1);
    assert.equal(await countById(pool, 'yuncms_permissions', permission.id), 1);
    assert.equal(await countById(pool, 'yuncms_auth_identities', identityId), 1);
    assert.equal(await countById(pool, 'yuncms_api_tokens', nonExpiringApiTokenId), 1);

    assert.equal(await countById(pool, 'yuncms_sessions', legacySession.session), 1);
    assert.equal(await countById(pool, 'yuncms_auth_tokens', actionTokenId), 1);
    assert.equal(await countById(pool, 'yuncms_auth_transactions', transactionId), 1);
    assert.equal(await countById(pool, 'yuncms_api_tokens', finiteApiTokenId), 1);

    // 3. Apply migration 0022 via bootstrapDatabase
    const upgraded = await bootstrapDatabase(pool);
    assert.deepEqual(upgraded.newlyApplied, ['0022-utc-auth-deadlines']);
    await assertDatabaseCompatible(pool);

    // Verify revocations
    assert.equal(await countById(pool, 'yuncms_sessions', legacySession.session), 0, 'Legacy session must be revoked');
    assert.equal(await countById(pool, 'yuncms_auth_tokens', actionTokenId), 0, 'Pending action token must be revoked');
    assert.equal(await countById(pool, 'yuncms_auth_transactions', transactionId), 0, 'Auth transaction must be revoked');
    assert.equal(await countById(pool, 'yuncms_api_tokens', finiteApiTokenId), 0, 'Expiring API token must be revoked');

    // Verify preservations
    assert.equal(await countById(pool, 'yuncms_roles', role.id), 1, 'Role must be preserved');
    assert.equal(await countById(pool, 'yuncms_users', user.id), 1, 'User must be preserved');
    assert.equal(await countById(pool, 'yuncms_permissions', permission.id), 1, 'Permission must be preserved');
    assert.equal(await countById(pool, 'yuncms_auth_identities', identityId), 1, 'External identity must be preserved');
    assert.equal(await countById(pool, 'yuncms_api_tokens', nonExpiringApiTokenId), 1, 'Non-expiring API token must be preserved');

    // 4. Create new session post-0022 and verify authentication works
    const newSession = await sessions.createForUser(user);
    const authIdentity = await sessions.authenticateAccessToken(newSession.access_token);
    assert.equal(authIdentity.user, user.id);
    assert.equal(await countById(pool, 'yuncms_sessions', newSession.session), 1);

    // 5. Applying migrations again (restart) must be a no-op and preserve newly created session
    const restart = await bootstrapDatabase(pool);
    assert.deepEqual(restart.newlyApplied, []);
    assert.equal(await countById(pool, 'yuncms_sessions', newSession.session), 1, 'Newly created session must be preserved on restart');
  } finally {
    const cleanupErrors = [];
    if (pool) {
      try {
        await closeDatabasePool(pool);
      } catch (err) {
        cleanupErrors.push(err);
      }
    }
    try {
      await resetDatabaseObjects({ config: config.database });
    } catch (err) {
      cleanupErrors.push(err);
    }
    if (cleanupErrors.length > 0) {
      throw new AggregateError(cleanupErrors, `Integration cleanup failed with ${cleanupErrors.length} error(s)`);
    }
  }
});
