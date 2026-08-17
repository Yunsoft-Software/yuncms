const ISOLATION_LEVELS = new Set([
  'READ UNCOMMITTED',
  'READ COMMITTED',
  'REPEATABLE READ',
  'SERIALIZABLE',
]);

async function setIsolationLevel(connection, isolationLevel) {
  if (!isolationLevel) return;
  const level = String(isolationLevel).toUpperCase();
  if (!ISOLATION_LEVELS.has(level)) {
    throw new Error(`Unsupported transaction isolation level: ${isolationLevel}`);
  }
  await connection.query(`SET TRANSACTION ISOLATION LEVEL ${level}`);
}

export async function withConnectionTransaction(connection, operation, options = {}) {
  if (!connection) throw new Error('Database connection is required');
  if (typeof operation !== 'function') throw new Error('Transaction operation is required');

  await setIsolationLevel(connection, options.isolationLevel);
  await connection.beginTransaction();

  try {
    const result = await operation(connection);
    await connection.commit();
    return result;
  } catch (error) {
    try {
      await connection.rollback();
    } catch (rollbackError) {
      error.rollbackError = rollbackError;
    }
    throw error;
  }
}

export async function withTransaction(pool, operation, options = {}) {
  const connection = await pool.getConnection();

  try {
    return await withConnectionTransaction(connection, operation, options);
  } finally {
    connection.release();
  }
}
