import mysql from 'mysql2/promise';

export function createDatabasePool(config) {
  if (!config) throw new Error('Database config is required');

  const pool = mysql.createPool({
    host: config.host,
    port: config.port,
    database: config.database,
    user: config.user,
    password: config.password,
    timezone: 'Z',
    dateStrings: ['DATE'],
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

  pool.on('connection', (connection) => {
    connection.query("SET SESSION time_zone = '+00:00'", (err) => {
      if (err) {
        connection.destroy(err);
      }
    });
  });

  return pool;
}

export async function pingDatabase(pool) {
  const [rows] = await pool.query('SELECT 1 AS ok');
  return Number(rows?.[0]?.ok) === 1;
}

export async function closeDatabasePool(pool) {
  if (pool) await pool.end();
}
