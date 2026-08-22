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
      `SELECT table_name, table_type
       FROM information_schema.tables
       WHERE table_schema = ?
       ORDER BY CASE WHEN table_type = 'VIEW' THEN 0 ELSE 1 END, table_name ASC`,
      [config.database],
    );

    await connection.query('SET FOREIGN_KEY_CHECKS = 0');
    try {
      for (const row of rows) {
        const name = quoteIdentifier(row.table_name, 'database object name');
        if (row.table_type === 'VIEW') {
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
