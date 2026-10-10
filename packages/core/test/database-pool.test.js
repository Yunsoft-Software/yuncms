import assert from 'node:assert/strict';
import test from 'node:test';
import mysql from 'mysql2';

import { createDatabasePool, closeDatabasePool } from '../src/database.js';

test('createDatabasePool configures timezone Z and dateStrings DATE by default', async () => {
  const pool = createDatabasePool({
    host: '127.0.0.1',
    port: 3306,
    database: 'yuncms_test',
    user: 'root',
    password: '',
  });

  try {
    const connConfig = pool.pool.config.connectionConfig;
    assert.equal(connConfig.timezone, 'Z');
    assert.deepEqual(connConfig.dateStrings, ['DATE']);
  } finally {
    await closeDatabasePool(pool);
  }
});

test('createDatabasePool queues SET SESSION time_zone on connection event', async () => {
  const pool = createDatabasePool({
    host: '127.0.0.1',
    port: 3306,
    database: 'yuncms_test',
    user: 'root',
    password: '',
  });

  let executedSql = null;
  const fakeConnection = {
    query(sql, callback) {
      executedSql = sql;
      callback(null);
    },
    destroy() {},
  };

  try {
    pool.pool.emit('connection', fakeConnection);
    assert.equal(executedSql, "SET SESSION time_zone = '+00:00'");
  } finally {
    await closeDatabasePool(pool);
  }
});

test('wire server: pool connection fails closed when SET SESSION time_zone fails', { timeout: 5000 }, async () => {
  const server = mysql.createServer();
  const sockets = new Set();
  const receivedQueries = [];

  server.on('connection', (conn) => {
    sockets.add(conn);
    conn.on('error', () => {});
    conn.serverHandshake({
      protocolVersion: 10,
      serverVersion: '8.0.36-wire-test',
      connectionId: 1,
      statusFlags: 2,
      characterSet: 33,
      capabilityFlags: 0xffffff,
      authCallback: (params, cb) => {
        cb(null);
      },
    });

    const handleSql = (sql) => {
      receivedQueries.push(sql);
      if (sql.includes('SET SESSION time_zone')) {
        conn.writeError({ code: 1298, message: 'Unknown or incorrect time zone: +00:00' });
      } else {
        conn.writeOk();
      }
    };

    conn.on('query', handleSql);
    conn.on('stmt_prepare', handleSql);
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server._server.address().port;

  const pool = createDatabasePool({
    host: '127.0.0.1',
    port,
    database: 'yuncms_wire_test',
    user: 'test_user',
    password: '',
  });

  let timer;
  const timeoutPromise = new Promise((_, reject) => {
    timer = setTimeout(() => {
      const timeoutErr = new Error('Timed out waiting for queued query rejection');
      timeoutErr.code = 'WIRE_QUERY_TIMEOUT';
      reject(timeoutErr);
    }, 3000);
  });

  let queryRejected = false;
  let rejectionError = null;

  try {
    await Promise.race([
      pool.query('SELECT 1 AS probe_unreachable'),
      timeoutPromise,
    ]);
  } catch (err) {
    queryRejected = true;
    rejectionError = err;
  } finally {
    clearTimeout(timer);
    for (const socket of sockets) {
      try {
        socket.destroy();
      } catch {}
    }
    await closeDatabasePool(pool);
    await new Promise((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });
  }

  assert.equal(queryRejected, true, 'Queued pool.query must reject when session time_zone init fails');
  assert.ok(rejectionError, 'Rejection error must be present');
  assert.notEqual(
    rejectionError.code,
    'WIRE_QUERY_TIMEOUT',
    'Rejection must come from pool/connection failure, not from wire query timeout',
  );
  assert.equal(
    receivedQueries.includes('SELECT 1 AS probe_unreachable'),
    false,
    'Application SELECT query must never reach the server when connection init fails',
  );
  assert.equal(
    receivedQueries.some((q) => q.includes('SET SESSION time_zone')),
    true,
    'Server must have received SET SESSION time_zone query',
  );
});
