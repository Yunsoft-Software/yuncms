import { createHash } from 'node:crypto';

export function databaseAdvisoryLockName(databaseName, lockName) {
  if (typeof databaseName !== 'string' || !databaseName || typeof lockName !== 'string' || !lockName) throw new TypeError('Database and advisory lock names are required');
  return `yuncms:db:${createHash('sha256').update(databaseName).digest('hex').slice(0, 20)}:${createHash('sha256').update(lockName).digest('hex').slice(0, 30)}`;
}

export async function withAdvisoryLock(pool, lockName, operation, { timeoutSeconds = 10 } = {}) {
  if (!pool) throw new Error('Database pool is required');
  if (!lockName || typeof lockName !== 'string') throw new Error('Advisory lock name is required');
  if (typeof operation !== 'function') throw new Error('Advisory lock operation is required');

  const connection = await pool.getConnection();
  // mysql2 promise pools/connections retain their selected database config.
  // Legacy query adapters have no native database identity and retain explicit names.
  const databaseName = connection.connection?.config?.database || pool.pool?.config?.connectionConfig?.database;
  if (databaseName) lockName = databaseAdvisoryLockName(databaseName, lockName);
  let acquired = false;

  try {
    const [rows] = await connection.query('SELECT GET_LOCK(?, ?) AS acquired', [lockName, timeoutSeconds]);
    acquired = Number(rows?.[0]?.acquired) === 1;

    if (!acquired) {
      const error = new Error(`Could not acquire advisory lock: ${lockName}`);
      error.code = 'SCHEMA_LOCK_UNAVAILABLE';
      throw error;
    }

    return await operation(connection);
  } finally {
    if (acquired) {
      try {
        await connection.query('SELECT RELEASE_LOCK(?) AS released', [lockName]);
      } catch {
        // Releasing the connection also drops connection-scoped MySQL locks.
      }
    }
    connection.release();
  }
}
