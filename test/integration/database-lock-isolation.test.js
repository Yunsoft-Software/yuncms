import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { bootstrapDatabase, CollectionsService, createCoreServiceRegistry, createDatabasePool, createSystemAccountability, databaseAdvisoryLockName, FieldsService, SchemaCache, closeDatabasePool, loadConfig, withAdvisoryLock, withTransaction } from '@yunsoft/yuncms-core';
import { singletonLockName } from '../../packages/core/src/services/singleton-services.js';

test('real MySQL: schema locks serialize one database while another instance installs independently', {
  skip: process.env.YUNCMS_TEST_MYSQL !== '1', timeout: 20000,
}, async t => {
  assert.equal(process.env.YUNCMS_TEST_DB_ALLOW_DESTRUCTIVE, '1');
  const config = loadConfig(process.env).database;
  assert.match(config.database, /(test|ci|dev)/i);
  const first = createDatabasePool(config), otherName = `yuncms_test_lock_${randomUUID().replaceAll('-', '')}`;
  await first.query(`CREATE DATABASE \`${otherName}\``);
  const other = createDatabasePool({ ...config, database: otherName });
  t.after(async () => { await closeDatabasePool(other); await first.query(`DROP DATABASE \`${otherName}\``); await closeDatabasePool(first); });
  let unlock, ready;
  const release = new Promise(resolve => { unlock = resolve; }), acquired = new Promise(resolve => { ready = resolve; });
  const held = withAdvisoryLock(first, 'yuncms:schema', async () => { ready(); await release; });
  try {
    await acquired;
    await assert.rejects(withAdvisoryLock(first, 'yuncms:schema', () => assert.fail('same database must wait'), { timeoutSeconds: 0 }), error => error.code === 'SCHEMA_LOCK_UNAVAILABLE');
    await withAdvisoryLock(other, 'yuncms:schema', async database => {
      await database.query('CREATE TABLE actual_install (id INT PRIMARY KEY)');
      const [rows] = await database.query("SHOW TABLES LIKE 'actual_install'");
      assert.equal(rows.length, 1);
    }, { timeoutSeconds: 0 });
  } finally { unlock(); await held; }
});

test('real MySQL: singleton outer transactions retain locks until rollback and commit', {
  skip: process.env.YUNCMS_TEST_MYSQL !== '1', timeout: 15000,
}, async t => {
  assert.equal(process.env.YUNCMS_TEST_DB_ALLOW_DESTRUCTIVE, '1');
  const config = loadConfig(process.env).database; assert.match(config.database, /(test|ci|dev)/i);
  const database = createDatabasePool({ ...config, connectionLimit: 2 }), collection = 'singleton_outer_' + randomUUID().slice(0, 8);
  const options = { database, accountability: createSystemAccountability(), schemaCache: new SchemaCache({ versionCheckTtlMs: 0 }) };
  t.after(async () => { await database.query(`DROP TABLE IF EXISTS \`${collection}\``); await database.query('DELETE FROM yuncms_collections WHERE collection = ?', [collection]); await closeDatabasePool(database); });
  await bootstrapDatabase(database); await new CollectionsService(options).createOne({ collection, singleton: true });
  await new FieldsService(options).createOne(collection, { field: 'title', type: 'string' });
  const Service = createCoreServiceRegistry().toObject().ItemsService;
  await assert.rejects(withTransaction(database, async connection => {
    await new Service(collection, { ...options, database: connection }).createOne({ title: 'rollback' });
    await assert.rejects(withAdvisoryLock(database, singletonLockName(collection), () => assert.fail('lock must remain held'), { timeoutSeconds: 0 }), { code: 'SCHEMA_LOCK_UNAVAILABLE' });
    throw Error('outer rollback');
  }), /outer rollback/);
  assert.equal((await new Service(collection, options).readMany()).length, 0);
  await withTransaction(database, connection => new Service(collection, { ...options, database: connection }).createMany([{ title: 'committed' }]));
  await assert.rejects(new Service(collection, options).createOne({ title: 'duplicate' }), { code: 'SINGLETON_ITEM_EXISTS' });
});

test('real MySQL: singleton single and bulk creation completes with a one-connection pool', {
  skip: process.env.YUNCMS_TEST_MYSQL !== '1', timeout: 15000,
}, async t => {
  assert.equal(process.env.YUNCMS_TEST_DB_ALLOW_DESTRUCTIVE, '1');
  const config = loadConfig(process.env).database; assert.match(config.database, /(test|ci|dev)/i);
  const database = createDatabasePool({ ...config, connectionLimit: 1 });
  const collection = 'singleton_pool_' + randomUUID().slice(0, 8);
  const options = { database, accountability: createSystemAccountability(), schemaCache: new SchemaCache({ versionCheckTtlMs: 0 }) };
  t.after(async () => { await database.query(`DROP TABLE IF EXISTS \`${collection}\``); await database.query('DELETE FROM yuncms_collections WHERE collection = ?', [collection]); await closeDatabasePool(database); });
  await bootstrapDatabase(database);
  await new CollectionsService(options).createOne({ collection, singleton: true });
  await new FieldsService(options).createOne(collection, { field: 'title', type: 'string', required: true });
  const Service = createCoreServiceRegistry().toObject().ItemsService;
  const service = new Service(collection, options), first = await service.createOne({ title: 'first' });
  assert.equal(first.title, 'first');
  await assert.rejects(service.createOne({ title: 'second' }), { code: 'SINGLETON_ITEM_EXISTS' });
  await service.deleteOne(first.id);
  assert.equal((await service.createMany([{ title: 'bulk' }]))[0].title, 'bulk');
});

test('real MySQL: advisory lock pool destroys connections when RELEASE_LOCK fails instead of recycling a held lock (#97)', {
  skip: process.env.YUNCMS_TEST_MYSQL !== '1', timeout: 20000,
}, async t => {
  assert.equal(process.env.YUNCMS_TEST_DB_ALLOW_DESTRUCTIVE, '1');
  const config = loadConfig(process.env).database; assert.match(config.database, /(test|ci|dev)/i);
  const rawPool = createDatabasePool({ ...config, connectionLimit: 2 });
  t.after(async () => { await closeDatabasePool(rawPool); });

  for (const mode of ['ok', 'zero', 'null', 'throw']) {
    let released = 0, destroyed = 0, heldRawConnection = null;
    const pool = {
      async getConnection() {
        const raw = await rawPool.getConnection();
        heldRawConnection = raw;
        return {
          connection: raw.connection,
          async query(sql, params) {
            if (String(sql).includes('RELEASE_LOCK')) {
              if (mode === 'zero') return [[{ released: 0 }], []];
              if (mode === 'null') return [[{ released: null }], []];
              if (mode === 'throw') throw new Error('unlock timeout');
            }
            return raw.query(sql, params);
          },
          release() {
            released += 1;
            raw.release();
          },
          destroy() {
            destroyed += 1;
            raw.destroy();
          },
        };
      },
    };
    const lockKey = `issue97:${mode}:${randomUUID()}`;
    const scopedLockName = databaseAdvisoryLockName(config.database, lockKey);
    try {
      const value = await withAdvisoryLock(pool, lockKey, async (conn) => {
        const [[row]] = await conn.query('SELECT IS_USED_LOCK(?) AS holder, CONNECTION_ID() AS conn_id', [scopedLockName]);
        assert.equal(Number(row.holder), Number(row.conn_id));
        return mode;
      }, { timeoutSeconds: 1 });
      assert.equal(value, mode);
      if (mode === 'ok') {
        assert.equal(released, 1);
        assert.equal(destroyed, 0);
      } else {
        assert.equal(released, 0, `mode ${mode} must not call connection.release()`);
        assert.equal(destroyed, 1, `mode ${mode} must call connection.destroy()`);
      }
      // Verify another connection from the pool can acquire the same advisory lock once the bad connection was destroyed.
      const reacquired = await withAdvisoryLock(rawPool, lockKey, async () => 'reacquired', { timeoutSeconds: 2 });
      assert.equal(reacquired, 'reacquired');
    } finally {
      try { heldRawConnection?.destroy(); } catch {}
    }
  }
});
