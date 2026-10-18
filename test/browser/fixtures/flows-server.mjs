import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createWriteStream } from 'node:fs';
import { readFile } from 'node:fs/promises';
import express from 'express';
import {
  bootstrapDatabase, CollectionsService, createCoreServiceRegistry, createDatabasePool, createStorageRegistry,
  createSystemAccountability, FieldsService, HookEmitter, ItemsService, loadConfig, LocalStorageDriver,
  PermissionsService, RolesService, SchemaCache, UsersService, SmtpMailer, createJsonLogger,
} from '@yunsoft/yuncms-core';
import { createApp } from '../../../packages/api/src/app.js';
import { FlowRuntime } from '../../../packages/api/src/flows/runtime.js';
import { startFlowNetwork } from '../../helpers/flow-network.mjs';
import { randomBytes } from 'node:crypto';
import { ExtensionError } from '@yunsoft/yuncms-extensions-sdk';
import { AiAssistantService } from '../../../packages/api/src/ai/service.js';
import { AiSettingsStore } from '../../../packages/api/src/ai/settings-store.js';
import { AiAutomationsService } from '../../../packages/api/src/automations/service.js';
import { AiAutomationWorker } from '../../../packages/api/src/automations/worker.js';
import { createAiRouter } from '../../../packages/api/src/routes/ai.js';
import { createAutomationsRouter } from '../../../packages/api/src/routes/automations.js';

if (process.env.YUNCMS_TEST_MYSQL !== '1' || process.env.YUNCMS_TEST_DB_ALLOW_DESTRUCTIVE !== '1') throw Error('Browser acceptance requires an explicitly authorized disposable MySQL database');
const config = loadConfig({ ...process.env, API_RATE_LIMIT_ENABLED: '0', AUTH_LOGIN_RATE_MAX: '200', PRESSURE_LIMIT_ENABLED: '0', FLOWS_SCRIPTS_ENABLED: '1' });
if (!/(test|ci|dev)/i.test(config.database.database)) throw Error('Browser fixture requires a disposable test/ci/dev database');
const pool = createDatabasePool({ ...config.database, connectionLimit: 5 }), accountability = createSystemAccountability();
const root = await mkdtemp(join(tmpdir(), 'yuncms-flows-browser-'));
const logPath = join(root, 'server.jsonl'), logStream = createWriteStream(logPath, { flags: 'a' });
const cache = new SchemaCache({ versionCheckTtlMs: 0 }), logger = createJsonLogger({ output: logStream, errorOutput: logStream });
const emitter = new HookEmitter({ logger }), services = createCoreServiceRegistry().toObject();
const storage = createStorageRegistry({ local: new LocalStorageDriver({ root }) });
const basic = { database: pool, accountability }, roleIds = [], userIds = [];
const collection = 'browser_flow_records';
let server, runtime, network, automationWorker;
const aiAdmissionEvents = [];
let allowAiGeneration = false;
async function close() {
  await automationWorker?.stop();
  await runtime?.stop();
  if (server) await new Promise(resolve => server.close(resolve));
  await network?.close();
  for (const id of userIds) await pool.query('DELETE FROM yuncms_flows WHERE user_created = ?', [id]);
  for (const id of userIds) await pool.query('DELETE FROM yuncms_ai_automations WHERE run_as = ?', [id]);
  await pool.query(`DROP TABLE IF EXISTS \`${collection}\``);
  await pool.query('DELETE FROM yuncms_collections WHERE collection = ?', [collection]);
  for (const id of userIds) await pool.query('DELETE FROM yuncms_users WHERE id = ?', [id]);
  for (const id of roleIds) { await pool.query('DELETE FROM yuncms_permissions WHERE role = ?', [id]); await pool.query('DELETE FROM yuncms_roles WHERE id = ?', [id]); }
  await pool.end(); await new Promise(resolve => logStream.end(resolve)); await rm(root, { recursive: true, force: true });
}
try {
  await bootstrapDatabase(pool);
  await new CollectionsService(basic).createOne({ collection });
  await new FieldsService(basic).createOne(collection, { field: 'title', type: 'string' });
  await new FieldsService(basic).createOne(collection, { field: 'status', type: 'string' });
  const adminRole = await new RolesService(basic).createOne({ name: 'Browser flow administrator', admin: true }); roleIds.push(adminRole.id);
  const staffRole = await new RolesService(basic).createOne({ name: 'Browser flow staff' }); roleIds.push(staffRole.id);
  const readerRole = await new RolesService(basic).createOne({ name: 'Browser content reader' }); roleIds.push(readerRole.id);
  const writerRole = await new RolesService(basic).createOne({ name: 'Browser content writer' }); roleIds.push(writerRole.id);
  const filteredRole = await new RolesService(basic).createOne({ name: 'Browser filtered writer' }); roleIds.push(filteredRole.id);
  const flowViewerRole = await new RolesService(basic).createOne({ name: 'Browser flow viewer' }); roleIds.push(flowViewerRole.id);
  for (const [email, role] of [['flows-admin@example.test', adminRole.id], ['flows-staff@example.test', staffRole.id], ['content-reader@example.test', readerRole.id], ['content-writer@example.test', writerRole.id], ['content-filtered@example.test', filteredRole.id], ['flows-viewer@example.test', flowViewerRole.id]]) {
    userIds.push((await new UsersService(basic).createOne({ email, role, password: 'Browser-flow-fixture-123!' })).id);
  }
  const schema = await cache.get(pool);
  // Default-deny real extension policy. Only the administrator fixture endpoint
  // can enable a bounded real-provider browser acceptance scenario.
  emitter.registerFilter('ai.provider.before', (payload, context) => {
    aiAdmissionEvents.push({ call_id: payload.call_id, user: context.accountability.user,
      admin: context.accountability.admin, requestId: context.requestId });
    if (!allowAiGeneration) throw new ExtensionError('AI_TOKENS_EXHAUSTED', 'AI capacity exhausted', { status: 402 });
    return payload;
  });
  const settingsStore = new AiSettingsStore({ database: pool, key: randomBytes(32) });
  await settingsStore.update({ enabled: true, writes_enabled: true, api_key: 'disposable-invalid-key',
    base_url: 'https://invalid.invalid/v1', model: 'unused' });
  const assistant = new AiAssistantService({ settingsStore, emitter, logger });
  const automationOptions = { assistant, settingsStore, schemaCache: cache };
  const automations = new AiAutomationsService({ ...automationOptions, ...basic, services, emitter, logger });
  for (const event of ['items.create', 'items.update']) emitter.registerAction(event,
    (payload, context) => automations.enqueue(event, payload, context));
  automationWorker = new AiAutomationWorker(automations);
  await new PermissionsService({ ...basic, schema }).createOne({ role: flowViewerRole.id, collection: 'yuncms_flows', action: 'read', filter: { name: { _starts_with: 'Delegated browser ' } } });
  for (const action of ['read', 'update']) await new PermissionsService({ ...basic, schema }).createOne({ role: staffRole.id, collection, action, fields: ['id', 'title', 'status'] });
  for (const [role, actions] of [[readerRole.id, ['read']], [writerRole.id, ['read', 'create', 'update', 'delete']], [filteredRole.id, ['read', 'update', 'delete']]]) {
    for (const action of actions) await new PermissionsService({ ...basic, schema }).createOne({ role, collection, action, fields: role === filteredRole.id && action === 'update' ? ['status'] : ['id', 'title', 'status'], ...(role === filteredRole.id && ['update', 'delete'].includes(action) ? { filter: { status: { _neq: 'locked' } } } : {}) });
  }
  await new ItemsService(collection, { ...basic, schema }).createOne({ title: 'Documentation article', status: 'draft' });
  network = await startFlowNetwork();
  const mailer = new SmtpMailer({ host: '127.0.0.1', port: network.smtpPort, from: 'flows@example.test', emitter });
  const flowsOptions = { scripts: config.flows.scripts, requestHosts: ['localhost'], flowEnv: { TEST_PUBLIC_VALUE: 'visible' } };
  runtime = new FlowRuntime({ database: pool, schemaCache: cache, services, emitter, storage, logger, mailer, ...flowsOptions }).registerHooks();
  const fixture = express.Router();
  fixture.use((req, _res, next) => { if (!req.accountability.admin) throw Object.assign(new Error('Fixture management requires administrator access'), { code: 'FORBIDDEN' }); next(); });
  fixture.get('/', (_req, res) => res.json({ data: { httpsUrl: network.httpsUrl, untrustedUrl: network.untrustedUrl, requests: network.requests, messages: network.messages, aiAdmissionEvents } }));
  fixture.post('/ai/allow', async (_req, res) => {
    if (!process.env.YUNCMS_TEST_REAL_PROVIDER_FILE) throw Error('Real provider file is required for browser AI acceptance');
    const provider = JSON.parse(await readFile(process.env.YUNCMS_TEST_REAL_PROVIDER_FILE, 'utf8'));
    await settingsStore.update({ enabled: true, writes_enabled: true,
      api_key: provider.OPENROUTER_API_KEY || provider.OPENROUTER_KEY || provider.AI_API_KEY,
      model: provider.AI_CHAT_MODEL, base_url: provider.OPENROUTER_BASE_URL || provider.AI_BASE_URL });
    allowAiGeneration = true; res.status(204).end();
  });
  fixture.post('/ai/deny', (_req, res) => { allowAiGeneration = false; res.status(204).end(); });
  // Exercise the real lifecycle, without replacing the queue, services or clock.
  // Re-register native admission hooks while the actual polling worker is stopped.
  fixture.post('/worker/pause', async (_req, res) => { await runtime.stop(); runtime.registerHooks(); res.status(204).end(); });
  fixture.post('/worker/resume', (_req, res) => { runtime.start(); res.status(204).end(); });
  fixture.get('/logs', async (_req, res) => {
    await new Promise(resolve => logStream.write('', resolve));
    res.json({ data: (await readFile(logPath, 'utf8')).split('\n').filter(Boolean).map(line => JSON.parse(line)) });
  });
  const app = createApp({ pool, config, schemaCache: cache, storage, emitter, logger, mailer, flowsOptions,
    aiRouter: createAiRouter({ assistant, settingsStore }), automationsRouter: createAutomationsRouter(automationOptions),
    endpointExtensions: [{ id: 'flow-fixture', router: fixture }] });
  server = await new Promise(resolve => { const instance = app.listen(Number(process.env.YUNCMS_BROWSER_PORT ?? 34074), '127.0.0.1', () => resolve(instance)); });
  runtime.start();
  automationWorker.start();
  process.stdout.write('Disposable native Flow browser server ready.\n');
} catch (error) { await close(); throw error; }
let stopping = false;
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, async () => { if (stopping) return; stopping = true; await close(); process.exit(0); });
