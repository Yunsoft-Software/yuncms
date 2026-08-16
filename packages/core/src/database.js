import mysql from 'mysql2/promise';

export function createDatabasePool(config) {
  if (!config) throw new Error('Database config is required');

  return mysql.createPool({
    host: config.host,
    port: config.port,
    database: config.database,
    user: config.user,
    password: config.password,
    waitForConnections: true,
    connectionLimit: config.connectionLimit ?? 10,
    queueLimit: 0,
    enableKeepAlive: true,
    keepAliveInitialDelay: 0,
    supportBigNumbers: true,
    bigNumberStrings: true,
    multipleStatements: false,
    ssl: config.ssl ? { minVersion: 'TLSv1.2' } : undefined,
  });
}

export async function pingDatabase(pool) {
  const [rows] = await pool.query('SELECT 1 AS ok');
  return rows?.[0]?.ok === 1;
}

export async function closeDatabasePool(pool) {
  if (pool) await pool.end();
}
