import assert from 'node:assert/strict';
import express from 'express';
import {
  createAccountability, createDatabasePool, createStorageRegistry, createSystemAccountability,
  loadConfig, LocalStorageDriver, MemoryCacheStore, PermissionsService, SchemaCache, withTransaction,
} from '@yunsoft/yuncms-core';
import { createApp } from '../../packages/api/src/app.js';

assert.equal(process.env.YUNCMS_TEST_MYSQL, '1');
assert.equal(process.env.YUNCMS_TEST_DB_ALLOW_DESTRUCTIVE, '1');
const config = loadConfig(process.env);
assert.match(config.database.database, /^yuncms_test_file_cache_[a-f0-9]{12}$/);
assert.ok(['127.0.0.1', 'localhost', '::1'].includes(config.database.host));
const pool = createDatabasePool(config.database);
const storage = createStorageRegistry({ local: new LocalStorageDriver({ root: process.env.FILE_CACHE_FIXTURE_ROOT }) });
const permissionCache = new MemoryCacheStore({ ttlMs: 120_000 });
const schemaCache = new SchemaCache({ versionCheckTtlMs: 0 });
const native = createApp({ pool, storage, config, schemaCache, permissionCache });

// Only the fixture controller can pause this genuine native transaction.
let finishPermissionWrite;
const rolledBack = new Error('Fixture requested rollback');
process.on('message', async message => {
  if (message.type === 'finish-permission-write') {
    finishPermissionWrite(message.commit);
    return;
  }
  if (message.type !== 'hold-permission-write') return;
  const decision = new Promise(resolve => { finishPermissionWrite = resolve; });
  let observedFilter;
  try {
    await withTransaction(pool, async database => {
      const options = { database, schemaCache, permissionCache };
      const writer = new PermissionsService({ ...options, accountability: createSystemAccountability() });
      await writer.updateOne(message.permissionId, { filter: message.filter });
      process.send({ phase: 'permission-write-held' });
      const commit = await decision;
      const reader = new PermissionsService({ ...options, accountability: createAccountability(message.reader) });
      const permission = await reader.resolve('read', 'yuncms_files');
      observedFilter = permission.filter;
      if (!commit) throw rolledBack;
    });
    process.send({ phase: 'permission-write-finished', committed: true, filter: observedFilter });
  } catch (error) {
    if (error === rolledBack) process.send({ phase: 'permission-write-finished', committed: false, filter: observedFilter });
    else process.send({ phase: 'permission-write-error', message: error.message });
  } finally {
    finishPermissionWrite = null;
  }
});
const app = express();
// Test a consumer-style URL alias, preserving the real native auth and handler.
// This does not add /assets/:id as a production YunCMS API.
app.get('/assets/:id', (req, res, next) => {
  req.url = '/files/' + encodeURIComponent(req.params.id) + '/content';
  native(req, res, next);
});
app.use(native);
const server = app.listen(Number(process.env.FILE_CACHE_FIXTURE_PORT), '127.0.0.1', () => {
  process.send({ port: server.address().port });
});
let stopping = false;
async function stop() {
  if (stopping) return; stopping = true;
  finishPermissionWrite?.(false);
  const closed = new Promise(resolve => server.close(resolve));
  server.closeAllConnections(); await closed; await pool.end();
  process.disconnect();
}
process.on('SIGTERM', () => stop().catch(error => { console.error(error); process.exitCode = 1; }));
process.on('disconnect', () => { if (!stopping) stop().catch(error => { console.error(error); process.exitCode = 1; }); });
