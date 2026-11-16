import assert from 'node:assert/strict';
import express from 'express';
import { createDatabasePool, createStorageRegistry, loadConfig, LocalStorageDriver, SchemaCache } from '@yunsoft/yuncms-core';
import { createApp } from '../../packages/api/src/app.js';

assert.equal(process.env.YUNCMS_TEST_MYSQL, '1');
assert.equal(process.env.YUNCMS_TEST_DB_ALLOW_DESTRUCTIVE, '1');
const config = loadConfig(process.env);
assert.match(config.database.database, /^yuncms_test_file_cache_[a-f0-9]{12}$/);
assert.ok(['127.0.0.1', 'localhost', '::1'].includes(config.database.host));
const pool = createDatabasePool(config.database);
const storage = createStorageRegistry({ local: new LocalStorageDriver({ root: process.env.FILE_CACHE_FIXTURE_ROOT }) });
const native = createApp({ pool, storage, config, schemaCache: new SchemaCache({ versionCheckTtlMs: 0 }) });
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
  const closed = new Promise(resolve => server.close(resolve));
  server.closeAllConnections(); await closed; await pool.end();
  process.disconnect();
}
process.on('SIGTERM', () => stop().catch(error => { console.error(error); process.exitCode = 1; }));
process.on('disconnect', () => { if (!stopping) stop().catch(error => { console.error(error); process.exitCode = 1; }); });
