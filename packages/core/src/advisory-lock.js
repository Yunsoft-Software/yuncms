export async function withAdvisoryLock(pool, lockName, operation, { timeoutSeconds = 10 } = {}) {
  if (!pool) throw new Error('Database pool is required');
  if (!lockName || typeof lockName !== 'string') throw new Error('Advisory lock name is required');
  if (typeof operation !== 'function') throw new Error('Advisory lock operation is required');

  const connection = await pool.getConnection();
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
