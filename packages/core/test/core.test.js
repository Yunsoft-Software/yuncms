import test from 'node:test';
import assert from 'node:assert/strict';

import { loadConfig } from '../src/config.js';
import { pingDatabase } from '../src/database.js';
import { quoteIdentifier } from '../src/identifier.js';
import { normalizeDatabaseError } from '../src/errors.js';
import { withDatabaseRetry } from '../src/retry.js';
import {
  createAccountability,
  createPublicAccountability,
  createSystemAccountability,
} from '../src/accountability.js';
import { createRequestContext } from '../src/context.js';
import { BaseService } from '../src/services/base-service.js';
import { createServiceRegistry } from '../src/services/service-registry.js';

test('loadConfig uses stable defaults and parses numeric values', () => {
  const defaults = loadConfig({});
  const config = loadConfig({ PORT: '9000', DB_CONNECTION_LIMIT: '20', DB_SSL: 'true' });

  assert.equal(defaults.server.port, 3008);
  assert.equal(defaults.server.studioOrigin, 'http://localhost:3008');
  assert.equal(defaults.auth.publicUrl, 'http://localhost:3008');
  assert.equal(config.server.port, 9000);
  assert.equal(config.server.studioOrigin, 'http://localhost:9000');
  assert.equal(config.auth.publicUrl, 'http://localhost:9000');
  assert.equal(config.database.connectionLimit, 20);
  assert.equal(config.database.ssl, true);
  assert.equal(config.database.host, '127.0.0.1');
});

test('database ping accepts mysql2 bigNumberStrings results', async () => {
  const pool = {
    async query(sql) {
      assert.equal(sql, 'SELECT 1 AS ok');
      return [[{ ok: '1' }]];
    },
  };

  assert.equal(await pingDatabase(pool), true);
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

test('accountability helpers never infer elevated access', () => {
  const user = createAccountability({ user: 'user-1', role: 'role-1' });
  const publicAccess = createPublicAccountability({ role: 'public-role' });
  const system = createSystemAccountability();

  assert.deepEqual(user, {
    user: 'user-1',
    role: 'role-1',
    admin: false,
    public: false,
    system: false,
  });
  assert.equal(publicAccess.public, true);
  assert.equal(publicAccess.admin, false);
  assert.equal(system.system, true);
  assert.equal(system.admin, true);
  assert.throws(() => createAccountability({ public: true, admin: true }), /Public accountability/);
});

test('request context propagates explicit dependencies', () => {
  const accountability = createAccountability({ user: 'user-1' });
  const database = {};
  const services = {};
  const context = createRequestContext({
    accountability,
    database,
    services,
    requestId: 'req-1',
  });

  assert.equal(context.accountability, accountability);
  assert.equal(context.database, database);
  assert.equal(context.services, services);
  assert.equal(context.requestId, 'req-1');
  assert.throws(() => createRequestContext({ database, services }), /Explicit accountability/);
});

test('service registry rejects duplicates and base services require context', () => {
  class ExampleService extends BaseService {}
  const registry = createServiceRegistry({ ExampleService });

  assert.equal(registry.has('ExampleService'), true);
  assert.equal(registry.get('ExampleService'), ExampleService);
  assert.equal(registry.toObject().ExampleService, ExampleService);
  assert.throws(() => registry.register('ExampleService', ExampleService), /already registered/);
  assert.throws(() => new ExampleService({ database: {} }), /Explicit accountability/);

  const instance = new ExampleService({
    database: {},
    accountability: createPublicAccountability(),
  });
  assert.equal(instance.accountability.public, true);
});
