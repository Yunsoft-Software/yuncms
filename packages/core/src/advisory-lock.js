import { AsyncLocalStorage } from 'node:async_hooks';
import { createHash } from 'node:crypto';
import { markConnectionDestroyed, registerTransactionCleanup } from './transaction.js';

const advisoryLockStorage = new AsyncLocalStorage();

function destroyLockConnection(connection) {
  markConnectionDestroyed(connection);
  try {
    if (typeof connection?.destroy === 'function') {
      connection.destroy();
    } else if (typeof connection?.connection?.destroy === 'function') {
      connection.connection.destroy();
    } else if (typeof connection?.connection?.stream?.destroy === 'function') {
      connection.connection.stream.destroy();
    }
  } catch {
    // Ignore destroy failures when discarding an uncertain lock connection.
  }
}

function connectionPoolIdentity(connection) {
  return connection?.connection?._pool ?? connection?._pool ?? null;
}

export function activeAdvisoryLockConnection(database) {
  if (!database || typeof database.getConnection !== 'function') return database;
  const store = advisoryLockStorage.getStore();
  if (!store?.active || !store?.connection) return database;
  if (store.pool === database) return store.connection;
  const poolIdentity = database.pool ?? null;
  const connPool = connectionPoolIdentity(store.connection);
  if (poolIdentity && connPool && poolIdentity === connPool) return store.connection;
  return database;
}

export function databaseAdvisoryLockName(databaseName, lockName) {
  if (typeof databaseName !== 'string' || !databaseName || typeof lockName !== 'string' || !lockName) throw new TypeError('Database and advisory lock names are required');
  return `yuncms:db:${createHash('sha256').update(databaseName).digest('hex').slice(0, 20)}:${createHash('sha256').update(lockName).digest('hex').slice(0, 30)}`;
}

export async function withAdvisoryLock(pool, lockName, operation, { timeoutSeconds = 10 } = {}) {
  if (!pool) throw new Error('Database pool is required');
  if (!lockName || typeof lockName !== 'string') throw new Error('Advisory lock name is required');
  if (typeof operation !== 'function') throw new Error('Advisory lock operation is required');

  const borrowed = typeof pool.getConnection === 'function';
  const connection = borrowed ? await pool.getConnection() : pool;
  // mysql2 promise pools/connections retain their selected database config.
  // Legacy query adapters have no native database identity and retain explicit names.
  const databaseName = connection.connection?.config?.database || pool.pool?.config?.connectionConfig?.database;
  if (databaseName) lockName = databaseAdvisoryLockName(databaseName, lockName);
  let acquired = false;
  let acquisitionUncertain = false;
  let unlocked = false;
  const lockScope = borrowed ? { pool, connection, active: false } : null;

  try {
    let rows;
    try {
      [rows] = await connection.query('SELECT GET_LOCK(?, ?) AS acquired', [lockName, timeoutSeconds]);
    } catch (error) {
      acquisitionUncertain = true;
      throw error;
    }
    acquired = Number(rows?.[0]?.acquired) === 1;

    if (!acquired) {
      const error = new Error(`Could not acquire advisory lock: ${lockName}`);
      error.code = 'SCHEMA_LOCK_UNAVAILABLE';
      throw error;
    }

    if (lockScope) {
      lockScope.active = true;
      return await advisoryLockStorage.run(lockScope, () => operation(connection));
    }
    return await operation(connection);
  } finally {
    if (lockScope) lockScope.active = false;
    const releaseLock = async () => {
      if (acquired) {
        try {
          const [rows] = await connection.query('SELECT RELEASE_LOCK(?) AS released', [lockName]);
          unlocked = Number(rows?.[0]?.released) === 1;
        } catch {
          unlocked = false;
        }
        if (!unlocked) {
          // Destroy, rather than return a connection still holding a lock.
          destroyLockConnection(connection);
        }
      }
    };
    if (acquisitionUncertain) {
      destroyLockConnection(connection);
    } else {
      // An outer mutation must retain singleton serialization until commit/rollback.
      // Transaction cleanup runs before borrowed connections return to their pool.
      const deferredToTransaction = acquired && registerTransactionCleanup(connection, releaseLock);
      if (!deferredToTransaction) await releaseLock();
      if (borrowed && (deferredToTransaction || !acquired || unlocked)) {
        connection.release();
      }
    }
  }
}
