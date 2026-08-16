const ISOLATION_LEVELS = new Set([
  'READ UNCOMMITTED',
  'READ COMMITTED',
  'REPEATABLE READ',
  'SERIALIZABLE',
]);

export async function withTransaction(pool, operation, options = {}) {
  const connection = await pool.getConnection();

  try {
    if (options.isolationLevel) {
      const level = String(options.isolationLevel).toUpperCase();
      if (!ISOLATION_LEVELS.has(level)) {
        throw new Error(`Unsupported transaction isolation level: ${options.isolationLevel}`);
      }
      await connection.query(`SET TRANSACTION ISOLATION LEVEL ${level}`);
    }

    await connection.beginTransaction();
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
  } finally {
    connection.release();
  }
}
