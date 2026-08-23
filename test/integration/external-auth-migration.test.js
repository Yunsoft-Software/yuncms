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
  ExternalAuthService,
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

test('real MySQL applies 0013 once and preserves pre-0013 auth state with replay-safe transactions', {
  skip: !ENABLED,
  timeout: 90_000,
}, async () => {
  const config = loadConfig(migrationEnv());
  let pool = null;

  try {
    await resetDatabaseObjects({ config: config.database });
    pool = createDatabasePool(config.database);

    const fresh = await bootstrapDatabase(pool);
    assert.deepEqual(fresh.newlyApplied, CORE_MIGRATIONS.map((migration) => migration.id));
    await assertDatabaseCompatible(pool);
    const freshRestart = await bootstrapDatabase(pool);
    assert.deepEqual(freshRestart.newlyApplied, []);

    await closeDatabasePool(pool);
    pool = null;
    await resetDatabaseObjects({ config: config.database });
    pool = createDatabasePool(config.database);

    const preExternalAuth = CORE_MIGRATIONS.slice(0, -1);
    const preUpgrade = await applyMigrations(pool, preExternalAuth);
    assert.deepEqual(preUpgrade.newlyApplied, preExternalAuth.map((migration) => migration.id));

    const system = createSystemAccountability();
    const roles = new RolesService({ accountability: system, database: pool });
    const users = new UsersService({ accountability: system, database: pool });
    const permissions = new PermissionsService({ accountability: system, database: pool });
    const role = await roles.createOne({ name: `Migration Reader ${randomUUID()}` });
    const user = await users.createOne({
      email: `migration-${randomUUID()}@example.test`,
      password: 'Migration-Test-Pass-1!',
      role: role.id,
      status: 'active',
      emailVerified: true,
    });
    const permission = await permissions.createOne({
      role: role.id,
      collection: 'yuncms_files',
      action: 'read',
    });
    const session = await new SessionsService({ accountability: system, database: pool }).createForUser(user);

    const upgraded = await bootstrapDatabase(pool);
    assert.deepEqual(upgraded.newlyApplied, ['0013-external-auth-foundation']);
    await assertDatabaseCompatible(pool);
    const restarted = await bootstrapDatabase(pool);
    assert.deepEqual(restarted.newlyApplied, []);

    const [migrationRows] = await pool.query(
      'SELECT COUNT(*) AS count FROM yuncms_schema_migrations WHERE id = ?',
      ['0013-external-auth-foundation'],
    );
    assert.equal(Number(migrationRows[0].count), 1);
    assert.equal(await countById(pool, 'yuncms_roles', role.id), 1);
    assert.equal(await countById(pool, 'yuncms_users', user.id), 1);
    assert.equal(await countById(pool, 'yuncms_permissions', permission.id), 1);
    assert.equal(await countById(pool, 'yuncms_sessions', session.session), 1);

    const external = new ExternalAuthService({
      accountability: system,
      database: pool,
      stateSecret: '0123456789abcdef0123456789abcdef',
    });
    const state = `state-${randomUUID()}`;
    const transaction = await external.beginTransaction({
      provider: 'integration-oidc',
      state,
      secret: { codeVerifier: 'pkce-secret', nonce: 'nonce-secret' },
      redirectTarget: '/content',
      metadata: { source: 'mysql-integration' },
    });
    assert.ok(transaction.id);
    await assert.rejects(
      external.beginTransaction({ provider: 'integration-oidc', state }),
      (error) => error.code === 'ER_DUP_ENTRY',
    );

    const consumed = await external.consumeTransaction({ provider: 'integration-oidc', state });
    assert.equal(consumed.redirectTarget, '/content');
    assert.deepEqual(consumed.secret, { codeVerifier: 'pkce-secret', nonce: 'nonce-secret' });
    assert.deepEqual(consumed.metadata, { source: 'mysql-integration' });
    await assert.rejects(
      external.consumeTransaction({ provider: 'integration-oidc', state }),
      (error) => error.code === 'INVALID_AUTH_TRANSACTION',
    );

    const expiredState = `expired-${randomUUID()}`;
    const expired = await external.beginTransaction({ provider: 'integration-oidc', state: expiredState });
    await pool.query(
      'UPDATE yuncms_auth_transactions SET expires_at = DATE_SUB(CURRENT_TIMESTAMP(3), INTERVAL 1 SECOND) WHERE id = ?',
      [expired.id],
    );
    await assert.rejects(
      external.consumeTransaction({ provider: 'integration-oidc', state: expiredState }),
      (error) => error.code === 'INVALID_AUTH_TRANSACTION',
    );

    await pool.query(
      `INSERT INTO yuncms_auth_identities (id, provider, subject, user)
       VALUES (?, ?, ?, ?)`,
      [randomUUID(), 'integration-oidc', 'stable-subject', user.id],
    );
    await assert.rejects(
      pool.query(
        `INSERT INTO yuncms_auth_identities (id, provider, subject, user)
         VALUES (?, ?, ?, ?)`,
        [randomUUID(), 'integration-oidc', 'stable-subject', user.id],
      ),
      (error) => error.code === 'ER_DUP_ENTRY',
    );
  } finally {
    if (pool) await closeDatabasePool(pool).catch(() => {});
    await resetDatabaseObjects({ config: config.database }).catch(() => {});
  }
});
