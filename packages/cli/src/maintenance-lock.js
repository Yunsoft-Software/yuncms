import { createHash } from 'node:crypto';

import {
  closeDatabasePool,
  createDatabasePool,
  loadConfig,
} from '@yunsoft/yuncms-core';

function lockName(databaseName) {
  const digest = createHash('sha256').update(String(databaseName)).digest('hex').slice(0, 32);
  return `yuncms:maintenance:${digest}`;
}

export function databaseMaintenanceLockName(databaseName) {
  return lockName(databaseName);
}

export async function acquireDatabaseMaintenanceLock({
  env = process.env,
  timeoutSeconds = 0,
  createPool = createDatabasePool,
  closePool = closeDatabasePool,
} = {}) {
  if (!Number.isInteger(timeoutSeconds) || timeoutSeconds < 0 || timeoutSeconds > 300) {
    const error = new Error('Maintenance lock timeout must be an integer between 0 and 300 seconds');
    error.code = 'MAINTENANCE_LOCK_TIMEOUT_INVALID';
    throw error;
  }

  const config = loadConfig(env);
  const pool = createPool(config.database);
  let connection;
  try {
    connection = await pool.getConnection();
  } catch (error) {
    await closePool(pool).catch(() => {});
    throw error;
  }

  const name = lockName(config.database.database);
  let acquired = false;
  let connectionId = null;

  try {
    const [rows] = await connection.query(
      'SELECT GET_LOCK(?, ?) AS acquired, CONNECTION_ID() AS connection_id',
      [name, timeoutSeconds],
    );
    acquired = Number(rows?.[0]?.acquired) === 1;
    connectionId = Number(rows?.[0]?.connection_id);
    if (!acquired || !Number.isInteger(connectionId) || connectionId <= 0) {
      const error = new Error(
        `Another YunCMS maintenance operation is using database ${config.database.database}`,
      );
      error.code = 'DATABASE_MAINTENANCE_LOCK_UNAVAILABLE';
      error.database = config.database.database;
      throw error;
    }
  } catch (error) {
    connection.release();
    await closePool(pool).catch(() => {});
    throw error;
  }

  let released = false;
  return {
    name,
    database: config.database.database,
    async assertHeld() {
      if (released) {
        const error = new Error('Database maintenance lock has already been released');
        error.code = 'DATABASE_MAINTENANCE_LOCK_LOST';
        throw error;
      }
      let rows;
      try {
        [rows] = await connection.query('SELECT IS_USED_LOCK(?) AS connection_id', [name]);
      } catch (cause) {
        const error = new Error(`Database maintenance lock connection was lost for ${config.database.database}`);
        error.code = 'DATABASE_MAINTENANCE_LOCK_LOST';
        error.database = config.database.database;
        error.cause = cause;
        throw error;
      }
      if (Number(rows?.[0]?.connection_id) !== connectionId) {
        const error = new Error(`Database maintenance lock is no longer held for ${config.database.database}`);
        error.code = 'DATABASE_MAINTENANCE_LOCK_LOST';
        error.database = config.database.database;
        throw error;
      }
      return true;
    },
    async release() {
      if (released) return;
      released = true;
      try {
        if (acquired) await connection.query('SELECT RELEASE_LOCK(?) AS released', [name]);
      } finally {
        connection.release();
        await closePool(pool);
      }
    },
  };
}
