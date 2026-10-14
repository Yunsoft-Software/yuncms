import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  bootstrapDatabase, CollectionsService, createCoreServiceRegistry, createDatabasePool, createStorageRegistry,
  createSystemAccountability, FieldsService, HookEmitter, ItemsService, loadConfig, LocalStorageDriver,
  PermissionsService, RolesService, SchemaCache, UsersService,
} from '@yunsoft/yuncms-core';
import { createApp } from '../../../packages/api/src/app.js';
import { FlowRuntime } from '../../../packages/api/src/flows/runtime.js';

if (process.env.YUNCMS_TEST_MYSQL !== '1' || process.env.YUNCMS_TEST_DB_ALLOW_DESTRUCTIVE !== '1') throw Error('Browser acceptance requires an explicitly authorized disposable MySQL database');
const config = loadConfig({ ...process.env, API_RATE_LIMIT_ENABLED: '0', AUTH_LOGIN_RATE_MAX: '100', PRESSURE_LIMIT_ENABLED: '0' });
if (!/(test|ci|dev)/i.test(config.database.database)) throw Error('Browser fixture requires a disposable test/ci/dev database');
const pool = createDatabasePool({ ...config.database, connectionLimit: 5 }), accountability = createSystemAccountability();
const root = await mkdtemp(join(tmpdir(), 'yuncms-flows-browser-'));
const cache = new SchemaCache({ versionCheckTtlMs: 0 }), logger = { info() {}, warn() {}, error(message, details) { process.stderr.write(`${message}: ${details?.code ?? ''}\n`); } };
const emitter = new HookEmitter({ logger }), services = createCoreServiceRegistry().toObject();
const storage = createStorageRegistry({ local: new LocalStorageDriver({ root }) });
const basic = { database: pool, accountability }, roleIds = [], userIds = [];
const collection = 'browser_flow_records';
let server, runtime;
async function close() {
  await runtime?.stop();
  if (server) await new Promise(resolve => server.close(resolve));
  for (const id of userIds) await pool.query('DELETE FROM yuncms_flows WHERE user_created = ?', [id]);
  await pool.query(`DROP TABLE IF EXISTS \`${collection}\``);
  await pool.query('DELETE FROM yuncms_collections WHERE collection = ?', [collection]);
  for (const id of userIds) await pool.query('DELETE FROM yuncms_users WHERE id = ?', [id]);
  for (const id of roleIds) { await pool.query('DELETE FROM yuncms_permissions WHERE role = ?', [id]); await pool.query('DELETE FROM yuncms_roles WHERE id = ?', [id]); }
  await pool.end(); await rm(root, { recursive: true, force: true });
}
try {
  await bootstrapDatabase(pool);
  await new CollectionsService(basic).createOne({ collection });
  await new FieldsService(basic).createOne(collection, { field: 'title', type: 'string' });
  await new FieldsService(basic).createOne(collection, { field: 'status', type: 'string' });
  const adminRole = await new RolesService(basic).createOne({ name: 'Browser flow administrator', admin: true }); roleIds.push(adminRole.id);
  const staffRole = await new RolesService(basic).createOne({ name: 'Browser flow staff' }); roleIds.push(staffRole.id);
  for (const [email, role] of [['flows-admin@example.test', adminRole.id], ['flows-staff@example.test', staffRole.id]]) {
    userIds.push((await new UsersService(basic).createOne({ email, role, password: 'Browser-flow-fixture-123!' })).id);
  }
  const schema = await cache.get(pool);
  for (const action of ['read', 'update']) await new PermissionsService({ ...basic, schema }).createOne({ role: staffRole.id, collection, action, fields: ['id', 'title', 'status'] });
  await new ItemsService(collection, { ...basic, schema }).createOne({ title: 'Documentation article', status: 'draft' });
  runtime = new FlowRuntime({ database: pool, schemaCache: cache, services, emitter, storage, logger }).registerHooks();
  const app = createApp({ pool, config, schemaCache: cache, storage, emitter, logger });
  server = await new Promise(resolve => { const instance = app.listen(Number(process.env.YUNCMS_BROWSER_PORT ?? 34074), '127.0.0.1', () => resolve(instance)); });
  runtime.start();
  process.stdout.write('Disposable native Flow browser server ready.\n');
} catch (error) { await close(); throw error; }
let stopping = false;
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, async () => { if (stopping) return; stopping = true; await close(); process.exit(0); });
