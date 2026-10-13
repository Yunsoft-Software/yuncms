import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { createDatabasePool, closeDatabasePool, loadConfig, withAdvisoryLock } from '@yunsoft/yuncms-core';

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
