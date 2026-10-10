import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';

import {
  ApiTokensService,
  AuthService,
  AuthTokensService,
  bootstrapDatabase,
  closeDatabasePool,
  createDatabasePool,
  createSystemAccountability,
  ExternalAuthService,
  loadConfig,
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
  if (!/(test|ci|dev)/i.test(config.database?.database ?? '')) {
    throw new Error(`Integration DB name must contain test, ci or dev: ${config.database?.database}`);
  }
}

function createPinnedDatabase(connection) {
  const adapter = {
    query: (sql, params) => connection.query(sql, params),
    beginTransaction: () => connection.beginTransaction(),
    commit: () => connection.commit(),
    rollback: () => connection.rollback(),
    release: () => {},
    getConnection: async () => adapter,
  };
  return adapter;
}

test('MySQL UTC auth deadline boundaries under non-UTC session time zone', {
  skip: !ENABLED,
  timeout: 60_000,
}, async () => {
  const config = loadConfig(process.env);
  requireDisposableDatabase(config);
  const pool = createDatabasePool(config.database);

  let connection = null;
  let originalTimezone = null;
  let usersService = null;
  let rolesService = null;
  let userId = null;
  let roleId = null;
  const createdTxIds = [];
  const cleanupErrors = [];

  try {
    await bootstrapDatabase(pool);
    connection = await pool.getConnection();
    const [[origTzRow]] = await connection.query('SELECT @@SESSION.time_zone AS tz');
    originalTimezone = origTzRow?.tz;
    await connection.query("SET SESSION time_zone = '+03:00'");

    const pinnedDb = createPinnedDatabase(connection);
    const system = createSystemAccountability();
    const token = suffix();

    usersService = new UsersService({ database: pinnedDb, accountability: system });
    rolesService = new RolesService({ database: pinnedDb, accountability: system });
    const apiTokensService = new ApiTokensService({ database: pinnedDb, accountability: system });
    const authService = new AuthService({ database: pinnedDb, accountability: system });
    const authTokensService = new AuthTokensService({ database: pinnedDb, accountability: system });
    const stateSecret = '01234567890123456789012345678901';
    const externalAuthService = new ExternalAuthService({
      database: pinnedDb,
      accountability: system,
      stateSecret,
    });

    async function getActionTokenId(uId, rawToken) {
      const hash = createHash('sha256').update(rawToken, 'utf8').digest('hex');
      const [rows] = await connection.query(
        'SELECT id FROM yuncms_auth_tokens WHERE user = ? AND token_hash = ?',
        [uId, hash],
      );
      assert.equal(rows.length, 1, 'Expected exact one matching action token row');
      return rows[0].id;
    }

    const role = await rolesService.createOne({
      name: `it_auth_tz_role_${token}`,
      description: 'Timezone test role',
    });
    roleId = role.id;

    const user = await usersService.createOne({
      email: `auth_tz_${token}@example.test`,
      password: 'TestPassword123!',
      role: role.id,
      status: 'active',
    });
    userId = user.id;

    // --- 1. API Tokens expiry and UTC last_used_at ---
    const inFiveMinutes = new Date(Date.now() + 5 * 60 * 1000);
    const finiteToken = await apiTokensService.createOne({
      user: user.id,
      name: `Finite ${token}`,
      expiresAt: inFiveMinutes,
    });

    const authResult = await authService.authenticateApiToken(finiteToken.token);
    assert.equal(authResult.user, user.id);

    const [tokenRows] = await connection.query(
      'SELECT TIMESTAMPDIFF(SECOND, last_used_at, UTC_TIMESTAMP(3)) AS diff FROM yuncms_api_tokens WHERE id = ?',
      [finiteToken.id],
    );
    assert.ok(
      Math.abs(Number(tokenRows[0]?.diff)) <= 5,
      `API token last_used_at must be near UTC_TIMESTAMP(3), diff: ${tokenRows[0]?.diff}`,
    );

    // Setting expires_at to 1 second before UTC_TIMESTAMP must cause rejection
    await connection.query(
      'UPDATE yuncms_api_tokens SET expires_at = DATE_SUB(UTC_TIMESTAMP(3), INTERVAL 1 SECOND) WHERE id = ?',
      [finiteToken.id],
    );
    await assert.rejects(
      () => authService.authenticateApiToken(finiteToken.token),
      (err) => err.code === 'INVALID_CREDENTIALS' || err.code === 'UNAUTHORIZED',
    );

    // Non-expiring token continues to authenticate
    const permToken = await apiTokensService.createOne({
      user: user.id,
      name: `Perm ${token}`,
    });
    const permAuth = await authService.authenticateApiToken(permToken.token);
    assert.equal(permAuth.user, user.id);

    // --- 2. Auth action tokens (password reset and email verification) ---
    // Password reset: valid +5min token works once
    const reset = await authTokensService.createForUser(user.id, 'reset', { ttlMs: 300_000 });
    const resetId = await getActionTokenId(user.id, reset.token);
    await authTokensService.resetPassword(reset.token, 'UpdatedPass123!');

    const [resetRows] = await connection.query(
      'SELECT TIMESTAMPDIFF(SECOND, used_at, UTC_TIMESTAMP(3)) AS diff FROM yuncms_auth_tokens WHERE id = ?',
      [resetId],
    );
    assert.ok(
      Math.abs(Number(resetRows[0]?.diff)) <= 5,
      `Password reset used_at must be near UTC_TIMESTAMP(3), diff: ${resetRows[0]?.diff}`,
    );

    // Reused reset token rejected
    await assert.rejects(
      () => authTokensService.resetPassword(reset.token, 'ReusedPass123!'),
      (err) => err.code === 'INVALID_TOKEN',
    );

    // Expired reset token rejected
    const expReset = await authTokensService.createForUser(user.id, 'reset', { ttlMs: 300_000 });
    const expResetId = await getActionTokenId(user.id, expReset.token);
    await connection.query(
      'UPDATE yuncms_auth_tokens SET expires_at = DATE_SUB(UTC_TIMESTAMP(3), INTERVAL 1 SECOND) WHERE id = ?',
      [expResetId],
    );
    await assert.rejects(
      () => authTokensService.resetPassword(expReset.token, 'ExpPass123!'),
      (err) => err.code === 'INVALID_TOKEN',
    );

    // Email verification: valid +5min token works once
    await connection.query('UPDATE yuncms_users SET email_verified_at = NULL WHERE id = ?', [user.id]);
    const verify = await authTokensService.createForUser(user.id, 'verify', { ttlMs: 300_000 });
    const verifyId = await getActionTokenId(user.id, verify.token);
    await authTokensService.verifyEmail(verify.token);

    const [verifyRows] = await connection.query(
      'SELECT TIMESTAMPDIFF(SECOND, used_at, UTC_TIMESTAMP(3)) AS diff FROM yuncms_auth_tokens WHERE id = ?',
      [verifyId],
    );
    assert.ok(
      Math.abs(Number(verifyRows[0]?.diff)) <= 5,
      `Email verification used_at must be near UTC_TIMESTAMP(3), diff: ${verifyRows[0]?.diff}`,
    );

    // Reused verify token rejected
    await assert.rejects(
      () => authTokensService.verifyEmail(verify.token),
      (err) => err.code === 'INVALID_TOKEN',
    );

    // Expired verify token rejected
    const expVerify = await authTokensService.createForUser(user.id, 'verify', { ttlMs: 300_000 });
    const expVerifyId = await getActionTokenId(user.id, expVerify.token);
    await connection.query(
      'UPDATE yuncms_auth_tokens SET expires_at = DATE_SUB(UTC_TIMESTAMP(3), INTERVAL 1 SECOND) WHERE id = ?',
      [expVerifyId],
    );
    await assert.rejects(
      () => authTokensService.verifyEmail(expVerify.token),
      (err) => err.code === 'INVALID_TOKEN',
    );

    // --- 3. External auth transactions ---
    const liveState = `live_state_${token}`;
    const liveTx = await externalAuthService.beginTransaction({
      provider: 'github',
      state: liveState,
      ttlMs: 300_000,
    });
    createdTxIds.push(liveTx.id);

    const consumed = await externalAuthService.consumeTransaction({
      provider: 'github',
      state: liveState,
    });
    assert.equal(consumed.id, liveTx.id);

    const [txRows] = await connection.query(
      'SELECT TIMESTAMPDIFF(SECOND, used_at, UTC_TIMESTAMP(3)) AS diff FROM yuncms_auth_transactions WHERE id = ?',
      [liveTx.id],
    );
    assert.ok(
      Math.abs(Number(txRows[0]?.diff)) <= 5,
      `Auth transaction used_at must be near UTC_TIMESTAMP(3), diff: ${txRows[0]?.diff}`,
    );

    // Reused transaction rejected
    await assert.rejects(
      () => externalAuthService.consumeTransaction({ provider: 'github', state: liveState }),
      (err) => err.code === 'INVALID_AUTH_TRANSACTION',
    );

    // Expired transaction rejected
    const expState = `exp_state_${token}`;
    const expTx = await externalAuthService.beginTransaction({
      provider: 'github',
      state: expState,
      ttlMs: 300_000,
    });
    createdTxIds.push(expTx.id);
    await connection.query(
      'UPDATE yuncms_auth_transactions SET expires_at = DATE_SUB(UTC_TIMESTAMP(3), INTERVAL 1 SECOND) WHERE id = ?',
      [expTx.id],
    );
    await assert.rejects(
      () => externalAuthService.consumeTransaction({ provider: 'github', state: expState }),
      (err) => err.code === 'INVALID_AUTH_TRANSACTION',
    );

    // Live unconsumed transaction preserved while expired/used are cleaned
    const keepState = `keep_state_${token}`;
    const keepTx = await externalAuthService.beginTransaction({
      provider: 'github',
      state: keepState,
      ttlMs: 300_000,
    });
    createdTxIds.push(keepTx.id);

    await externalAuthService.cleanupTransactions({ batchSize: 100 });

    const [expRemaining] = await connection.query(
      'SELECT id FROM yuncms_auth_transactions WHERE id IN (?, ?)',
      [liveTx.id, expTx.id],
    );
    assert.equal(expRemaining.length, 0, 'consumed and expired transactions must be cleaned up');

    const [keepRemaining] = await connection.query(
      'SELECT id FROM yuncms_auth_transactions WHERE id = ?',
      [keepTx.id],
    );
    assert.equal(keepRemaining.length, 1, 'live unconsumed transaction must be preserved');
  } finally {
    if (createdTxIds.length > 0 && connection) {
      try {
        const placeholders = createdTxIds.map(() => '?').join(', ');
        await connection.query(
          `DELETE FROM yuncms_auth_transactions WHERE id IN (${placeholders})`,
          createdTxIds,
        );
      } catch (err) {
        cleanupErrors.push(err);
      }
    }

    if (userId && usersService) {
      try {
        await usersService.deleteOne(userId);
      } catch (err) {
        cleanupErrors.push(err);
      }
    }

    if (roleId && rolesService) {
      try {
        await rolesService.deleteOne(roleId);
      } catch (err) {
        cleanupErrors.push(err);
      }
    }

    if (connection && originalTimezone) {
      try {
        await connection.query('SET SESSION time_zone = ?', [originalTimezone]);
      } catch (err) {
        cleanupErrors.push(err);
      }
    }

    if (connection) {
      try {
        connection.release();
      } catch (err) {
        cleanupErrors.push(err);
      }
    }

    try {
      await closeDatabasePool(pool);
    } catch (err) {
      cleanupErrors.push(err);
    }

    if (cleanupErrors.length > 0) {
      throw new AggregateError(
        cleanupErrors,
        `Cleanup failed with ${cleanupErrors.length} error(s): ${cleanupErrors.map((e) => e.message).join('; ')}`,
      );
    }
  }
});
