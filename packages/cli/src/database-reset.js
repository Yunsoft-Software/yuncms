import {
  closeDatabasePool,
  createDatabasePool,
  quoteIdentifier,
} from '@yunsoft/yuncms-core';

export async function resetDatabaseObjects({
  config,
  createPool = createDatabasePool,
  closePool = closeDatabasePool,
} = {}) {
  if (!config?.database) throw new Error('Database config is required');

  const pool = createPool(config);
  const connection = await pool.getConnection();
  try {
    const [rows] = await connection.query(
      `SELECT TABLE_NAME AS object_name, TABLE_TYPE AS object_type
       FROM information_schema.tables
       WHERE TABLE_SCHEMA = ?
       ORDER BY CASE WHEN TABLE_TYPE = 'VIEW' THEN 0 ELSE 1 END, TABLE_NAME ASC`,
      [config.database],
    );

    await connection.query('SET FOREIGN_KEY_CHECKS = 0');
    try {
      for (const row of rows) {
        const name = quoteIdentifier(row.object_name, 'database object name');
        if (row.object_type === 'VIEW') {
          await connection.query(`DROP VIEW IF EXISTS ${name}`);
        } else {
          await connection.query(`DROP TABLE IF EXISTS ${name}`);
        }
      }
    } finally {
      await connection.query('SET FOREIGN_KEY_CHECKS = 1').catch(() => {});
    }

    return rows.length;
  } finally {
    connection.release();
    await closePool(pool);
  }
}
