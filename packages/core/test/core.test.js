import test from 'node:test';
import assert from 'node:assert/strict';

import { loadConfig } from '../src/config.js';
import { quoteIdentifier } from '../src/identifier.js';
import { normalizeDatabaseError } from '../src/errors.js';
import { withDatabaseRetry } from '../src/retry.js';

test('loadConfig uses stable defaults and parses numeric values', () => {
  const config = loadConfig({ PORT: '9000', DB_CONNECTION_LIMIT: '20', DB_SSL: 'true' });

  assert.equal(config.server.port, 9000);
  assert.equal(config.database.connectionLimit, 20);
  assert.equal(config.database.ssl, true);
  assert.equal(config.database.host, '127.0.0.1');
});

test('quoteIdentifier rejects unsafe SQL identifiers', () => {
  assert.equal(quoteIdentifier('customer_orders'), '`customer_orders`');
  assert.throws(() => quoteIdentifier('orders; DROP TABLE users'), /Invalid SQL identifier/);
  assert.throws(() => quoteIdentifier('orders.name'), /Invalid SQL identifier/);
});

test('database errors are normalized without losing mysql code', () => {
  const normalized = normalizeDatabaseError({ code: 'ER_DUP_ENTRY', errno: 1062, message: 'duplicate' });

  assert.equal(normalized.code, 'DUPLICATE_KEY');
  assert.equal(normalized.mysqlCode, 'ER_DUP_ENTRY');
  assert.equal(normalized.errno, 1062);
});

test('retry helper retries only retryable database errors', async () => {
  let calls = 0;
  const result = await withDatabaseRetry(async () => {
    calls += 1;
    if (calls < 3) throw { code: 'ER_LOCK_DEADLOCK' };
    return 'ok';
  }, { sleep: async () => {}, baseDelayMs: 0 });

  assert.equal(result, 'ok');
  assert.equal(calls, 3);
});

test('retry helper fails closed for unrelated errors', async () => {
  let calls = 0;

  await assert.rejects(
    withDatabaseRetry(async () => {
      calls += 1;
      throw new Error('boom');
    }, { sleep: async () => {} }),
    /boom/,
  );

  assert.equal(calls, 1);
});
