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
  const connection = await pool.getConnection();
  const name = lockName(config.database.database);
  let acquired = false;

  try {
    const [rows] = await connection.query(
      'SELECT GET_LOCK(?, ?) AS acquired',
      [name, timeoutSeconds],
    );
    acquired = Number(rows?.[0]?.acquired) === 1;
    if (!acquired) {
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
