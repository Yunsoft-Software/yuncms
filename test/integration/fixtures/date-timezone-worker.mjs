// Timezone and session expiration worker fixture
// Tracks: https://github.com/Yunsoft-Software/yuncms/issues/38
import {
  closeDatabasePool,
  createDatabasePool,
  createSystemAccountability,
  ItemsService,
  loadConfig,
} from '@yunsoft/yuncms-core';
import { SessionsService } from '../../../packages/core/src/services/sessions-service.js';

const ENABLED = process.env.YUNCMS_TEST_MYSQL === '1';
const DESTRUCTIVE = process.env.YUNCMS_TEST_DB_ALLOW_DESTRUCTIVE === '1';

function requireDisposableDatabase(config) {
  if (!ENABLED) {
    const error = new Error('YUNCMS_TEST_MYSQL=1 is required');
    error.code = 'INTEGRATION_DISABLED';
    throw error;
  }
  if (!DESTRUCTIVE) {
    const error = new Error('YUNCMS_TEST_DB_ALLOW_DESTRUCTIVE=1 is required');
    error.code = 'DESTRUCTIVE_REQUIRED';
    throw error;
  }
  const dbName = config.database?.database ?? '';
  if (!/(test|ci|dev)/i.test(dbName)) {
    const error = new Error('Integration DB name must contain test, ci or dev');
    error.code = 'DISPOSABLE_DB_REQUIRED';
    throw error;
  }
}

// Parse CLI flags (credentials inherited from process.env, never passed via CLI args)
const args = Object.fromEntries(
  process.argv.slice(2).map((arg) => {
    const raw = arg.replace(/^--/, '');
    const eqIdx = raw.indexOf('=');
    if (eqIdx === -1) return [raw, true];
    return [raw.slice(0, eqIdx), raw.slice(eqIdx + 1)];
  }),
);

const mode = args.mode || 'date';
const sessionTz = args['session-tz'] || '+00:00';

let pool;
let connection;
let cleanupError = null;

try {
  const config = loadConfig(process.env);
  requireDisposableDatabase(config);

  pool = createDatabasePool(config.database);
  connection = await pool.getConnection();

  // Pinned connection: strictly connection session time_zone, never GLOBAL
  await connection.query('SET time_zone = ?', [sessionTz]);

  const system = createSystemAccountability();

  if (mode === 'date') {
    const collection = args.collection;
    const itemId = args.id;
    const fieldName = args.field || 'record_date';
    const items = new ItemsService(collection, {
      database: connection,
      accountability: system,
    });

    const item = await items.readOne(itemId);
    const serialized = JSON.parse(JSON.stringify(item));

    // Output ONLY id and date/time value; never entire item or configs
    console.log(JSON.stringify({
      ok: true,
      id: itemId,
      value: serialized[fieldName],
    }));
  } else if (mode === 'session') {
    const userId = args['user-id'];
    const action = args.action || 'authenticate';
    const sessions = new SessionsService({
      database: connection,
      accountability: system,
    });

    let success = false;
    let errorCode = null;
    let authenticatedUser = null;

    try {
      if (action === 'authenticate') {
        const created = await sessions.createForUser({ id: userId });
        try {
          const identity = await sessions.authenticateAccessToken(created.access_token);
          success = Boolean(identity && identity.user === userId);
          authenticatedUser = identity?.user ?? null;
        } catch (authError) {
          success = false;
          errorCode = authError.code || 'AUTHENTICATION_FAILED';
        }
      } else if (action === 'refresh') {
        const created = await sessions.createForUser({ id: userId });
        const rotated = await sessions.rotateRefreshToken(created.refresh_token);
        const identity = await sessions.authenticateAccessToken(rotated.access_token);
        success = Boolean(identity && identity.user === userId);
        authenticatedUser = identity?.user ?? null;
      } else if (action === 'replay') {
        const created = await sessions.createForUser({ id: userId });
        await sessions.rotateRefreshToken(created.refresh_token);
        try {
          await sessions.rotateRefreshToken(created.refresh_token);
          success = false;
          errorCode = 'REPLAY_NOT_REJECTED';
        } catch (replayError) {
          success = replayError.code === 'INVALID_CREDENTIALS';
          errorCode = replayError.code;
        }
      } else if (action === 'expired') {
        const created = await sessions.createForUser({ id: userId }, {
          accessTtlMs: -1000,
        });
        try {
          await sessions.authenticateAccessToken(created.access_token);
          success = false;
          errorCode = 'EXPIRED_NOT_REJECTED';
        } catch (expiredError) {
          success = expiredError.code === 'INVALID_CREDENTIALS';
          errorCode = expiredError.code;
        }
      } else {
        const err = new Error(`Unsupported session action: ${action}`);
        err.code = 'UNSUPPORTED_ACTION';
        throw err;
      }
    } catch (err) {
      success = false;
      errorCode = err.code || 'SESSION_ERROR';
    }

    try {
      await sessions.revokeAllForUser(userId);
    } catch (revokeErr) {
      cleanupError = revokeErr;
    }

    // Output ONLY authenticated/success boolean, clean error code, user id;
    // NO tokens, passwords, configs or environments in stdout
    console.log(JSON.stringify({
      ok: true,
      mode: 'session',
      action,
      authenticated: action === 'authenticate' ? success : undefined,
      success,
      errorCode,
      user: authenticatedUser,
    }));
  } else {
    const error = new Error(`Unsupported worker mode: ${mode}`);
    error.code = 'UNSUPPORTED_MODE';
    throw error;
  }
} catch (error) {
  // Output ONLY clean error code on stderr; no message or config
  console.error(JSON.stringify({
    ok: false,
    code: error.code || 'WORKER_ERROR',
  }));
  process.exitCode = 1;
} finally {
  const cleanupErrors = [];
  if (cleanupError) {
    cleanupErrors.push(cleanupError);
  }
  if (connection) {
    try {
      connection.release();
    } catch (releaseErr) {
      cleanupErrors.push(releaseErr);
    }
  }
  if (pool) {
    try {
      await closeDatabasePool(pool);
    } catch (closeErr) {
      cleanupErrors.push(closeErr);
    }
  }

  if (cleanupErrors.length > 0) {
    console.error(JSON.stringify({
      ok: false,
      code: cleanupErrors[0].code || 'CLEANUP_FAILED',
    }));
    process.exitCode = 1;
  }
}
