import assert from 'node:assert/strict';
import test from 'node:test';
import { randomBytes, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { ExtensionError } from '@yunsoft/yuncms-extensions-sdk';
import { bootstrapDatabase, createDatabasePool, createSystemAccountability, createCoreServiceRegistry,
  CollectionsService, FieldsService, RolesService, UsersService, PermissionsService, ItemsService,
  HookEmitter, SchemaCache, loadConfig } from '@yunsoft/yuncms-core';
import { createApp } from '../../packages/api/src/app.js';
import { AiAssistantService } from '../../packages/api/src/ai/service.js';
import { AiSettingsStore } from '../../packages/api/src/ai/settings-store.js';
import { AiAutomationsService } from '../../packages/api/src/automations/service.js';
import { AiAutomationWorker } from '../../packages/api/src/automations/worker.js';
import { createAutomationsRouter } from '../../packages/api/src/routes/automations.js';

test('real provider and MySQL: preview and workers share admission, Run as and usage settlement', {
  skip: process.env.YUNCMS_TEST_MYSQL !== '1', timeout: 180000,
}, async t => {
  assert.equal(process.env.YUNCMS_TEST_DB_ALLOW_DESTRUCTIVE, '1');
  const config = loadConfig(process.env);
  assert.match(config.database.database, /(test|ci|dev)/i);
  assert.ok(process.env.YUNCMS_TEST_REAL_PROVIDER_FILE, 'Real provider file is required for AI integration acceptance');
  const provider = JSON.parse(await readFile(process.env.YUNCMS_TEST_REAL_PROVIDER_FILE, 'utf8'));
  const database = createDatabasePool(config.database);
  t.after(() => database.end());
  await bootstrapDatabase(database);
  const emitter = new HookEmitter(), schemaCache = new SchemaCache({ versionCheckTtlMs: 0 });
  const services = createCoreServiceRegistry().toObject();
  const options = { database, emitter, schemaCache, accountability: createSystemAccountability() };
  const marker = randomUUID().slice(0, 8), collection = `automation_admission_${marker}`;
  const password = 'Disposable-automation-admission-9173!';
  const adminRole = await new RolesService(options).createOne({ name: `Automation administrator ${marker}`, admin: true });
  const admin = await new UsersService(options).createOne({ email: `automation-admin-${marker}@example.test`, password, role: adminRole.id });
  const role = await new RolesService(options).createOne({ name: `Automation Run as ${marker}` });
  const actor = await new UsersService(options).createOne({ email: `automation-actor-${marker}@example.test`, password, role: role.id });
  await new CollectionsService(options).createOne({ collection });
  for (const field of ['source_text', 'summary']) await new FieldsService(options).createOne(collection, { field, type: 'text' });
  for (const action of ['read', 'update']) await new PermissionsService(options).createOne({ role: role.id, collection, action,
    fields: action === 'read' ? ['id', 'source_text', 'summary'] : ['summary'] });
  const items = new ItemsService(collection, options);
  const record = await items.createOne({ source_text: marker, summary: 'original' });
  const settingsStore = new AiSettingsStore({ database, key: randomBytes(32) });
  await settingsStore.update({ enabled: true, writes_enabled: true,
    api_key: provider.OPENROUTER_API_KEY || provider.OPENROUTER_KEY || provider.AI_API_KEY,
    model: provider.AI_CHAT_MODEL, base_url: provider.OPENROUTER_BASE_URL || provider.AI_BASE_URL,
    provider: provider.AI_PROVIDER_ROUTING ?? null });
  const assistant = new AiAssistantService({ settingsStore, emitter });
  const automationOptions = { assistant, settingsStore, schemaCache };
  const service = new AiAutomationsService({ ...automationOptions, ...options, services });
  const worker = new AiAutomationWorker(service);
  for (const event of ['items.create', 'items.update']) emitter.registerAction(event, (payload, context) => service.enqueue(event, payload, context));
  let deny = true;
  const started = [], completed = [], failed = [];
  emitter.registerFilter('ai.provider.before', (payload, context) => {
    assert.equal(context.database, database);
    assert.equal(context.accountability.user, actor.id);
    assert.equal(context.accountability.admin, false);
    assert.equal(context.accountability.system, false);
    assert.match(context.requestId, /^[a-f0-9-]{36}$/);
    started.push(payload.call_id);
    if (deny) throw new ExtensionError('AI_TOKENS_EXHAUSTED', 'AI capacity exhausted', { status: 402 });
    return payload;
  });
  emitter.registerFilter('ai.provider.completed', (payload, context) => {
    assert.equal(context.accountability.user, actor.id);
    assert.ok(payload.usage.totalTokens > 0);
    completed.push(payload.call_id);
    return payload;
  });
  emitter.registerAction('ai.provider.failed', payload => failed.push(payload));
  const app = createApp({ pool: database, config, emitter, schemaCache,
    automationsRouter: createAutomationsRouter(automationOptions) });
  const server = await new Promise(resolve => { const instance = app.listen(0, '127.0.0.1', () => resolve(instance)); });
  t.after(() => new Promise(resolve => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  const login = await fetch(`${base}/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: admin.email, password }) });
  assert.equal(login.status, 200);
  const headers = { authorization: `Bearer ${(await login.json()).data.access_token}`, 'content-type': 'application/json' };
  const rule = { name: 'Admission regression', collection, run_as: actor.id, enabled: true, on_create: false, on_update: true,
    input_fields: ['source_text'], output_fields: ['summary'], instruction: `Return only a JSON object with summary set to the exact string ${marker}.` };
  const preview = () => fetch(`${base}/automations/preview`, { method: 'POST', headers, body: JSON.stringify({ rule, item_key: String(record.id) }) });
  assert.equal((await preview()).status, 402);
  assert.equal((await items.readOne(record.id)).summary, 'original');
  assert.equal(started.length, 1); assert.equal(completed.length, 0);
  assert.equal(failed[0].provider_completed, false);
  const created = await fetch(`${base}/automations`, { method: 'POST', headers, body: JSON.stringify(rule) });
  assert.equal(created.status, 201);
  const savedRule = (await created.json()).data;
  await items.updateOne(record.id, { source_text: `${marker} queued` });
  await worker.tick();
  const [[blocked]] = await database.query('SELECT * FROM yuncms_ai_automation_runs WHERE automation_id=?', [savedRule.id]);
  assert.equal(blocked.status, 'failed'); assert.equal(blocked.error_code, 'AI_TOKENS_EXHAUSTED');
  assert.equal(blocked.attempts, 1); assert.equal((await items.readOne(record.id)).summary, 'original');
  deny = false;
  const proposed = await preview(), proposedBody = await proposed.json();
  assert.equal(proposed.status, 200, JSON.stringify(proposedBody));
  assert.equal(proposedBody.data.proposed.summary, marker);
  assert.equal((await items.readOne(record.id)).summary, 'original');
  const retry = await fetch(`${base}/automations/runs/${blocked.id}/retry`, { method: 'POST', headers });
  assert.equal(retry.status, 200);
  await new AiAutomationWorker(service).tick();
  const [[settled]] = await database.query('SELECT * FROM yuncms_ai_automation_runs WHERE id=?', [blocked.id]);
  assert.equal(settled.status, 'succeeded', settled.error_code); assert.equal(settled.attempts, 1);
  assert.equal((await items.readOne(record.id)).summary, marker);
  assert.equal(started.length, 4); assert.equal(completed.length, 2); assert.equal(failed.length, 2);
  assert.equal(new Set(started).size, 4);
  assert.deepEqual(completed, started.slice(2));
  await new AiAutomationWorker(service).tick();
  assert.equal(started.length, 4);
});
