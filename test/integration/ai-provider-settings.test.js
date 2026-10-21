import assert from 'node:assert/strict';
import test from 'node:test';
import { randomBytes, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { applyMigrations, bootstrapDatabase, CORE_MIGRATIONS, createDatabasePool, createSystemAccountability,
  loadConfig, RolesService, UsersService, CollectionsService, FieldsService, PermissionsService, ItemsService, HookEmitter, SchemaCache } from '@yunsoft/yuncms-core';
import { resetDatabaseObjects } from '../../packages/cli/src/database-reset.js';
import { AiSettingsStore, encryptAiSecret } from '../../packages/api/src/ai/settings-store.js';
import { AiAssistantService } from '../../packages/api/src/ai/service.js';
import { createAiRouter } from '../../packages/api/src/routes/ai.js';
import { createApp } from '../../packages/api/src/app.js';

test('real MySQL/native HTTP: provider settings upgrade preserves secrets, authorization and explicit endpoint/key ownership', {
  skip: process.env.YUNCMS_TEST_MYSQL !== '1', timeout: 90000,
}, async t => {
  assert.equal(process.env.YUNCMS_TEST_DB_ALLOW_DESTRUCTIVE, '1');
  const databaseName = process.env.YUNCMS_MIGRATION_TEST_DB_DATABASE;
  assert.match(databaseName, /(test|ci|dev)/i); assert.notEqual(databaseName, process.env.DB_DATABASE);
  const config = loadConfig({ ...process.env, DB_DATABASE: databaseName });
  await resetDatabaseObjects({ config: config.database });
  const database = createDatabasePool(config.database); t.after(() => database.end());
  await applyMigrations(database, CORE_MIGRATIONS.slice(0, CORE_MIGRATIONS.findIndex(entry => entry.id === '0025-ai-provider-routing')));
  const key = randomBytes(32), originalSecret = 'Synthetic-before-provider-migration', encrypted = encryptAiSecret(originalSecret, key);
  await database.query('UPDATE yuncms_ai_settings SET enabled=1, model=?, api_key_ciphertext=?, max_output_tokens=2048 WHERE id=1', ['legacy-model', encrypted]);
  await assert.rejects(database.query('SELECT provider FROM yuncms_ai_settings'), { code: 'ER_BAD_FIELD_ERROR' });
  const upgraded = await bootstrapDatabase(database);
  assert.deepEqual(upgraded.newlyApplied, ['0025-ai-provider-routing', '0026-ai-output-constraints']);
  const store = new AiSettingsStore({ database, key });
  assert.equal((await store.readAdmin()).provider, null); assert.equal((await store.readRuntime()).apiKey, originalSecret);
  const [[preserved]] = await database.query('SELECT api_key_ciphertext, model, enabled, max_output_tokens, provider FROM yuncms_ai_settings');
  assert.equal(preserved.api_key_ciphertext, encrypted); assert.equal(preserved.model, 'legacy-model');
  assert.equal(preserved.enabled, 1); assert.equal(preserved.max_output_tokens, 2048); assert.equal(preserved.provider, null);

  const options = { database, accountability: createSystemAccountability() }, marker = randomUUID().slice(0, 8);
  const password = 'Disposable-provider-settings-123!';
  const adminRole = await new RolesService(options).createOne({ name: `Provider administrator ${marker}`, admin: true });
  const staffRole = await new RolesService(options).createOne({ name: `Provider staff ${marker}` });
  const users = new UsersService(options);
  const admin = await users.createOne({ email: `provider-admin-${marker}@example.test`, password, role: adminRole.id });
  const staff = await users.createOne({ email: `provider-staff-${marker}@example.test`, password, role: staffRole.id });
  const assistant = new AiAssistantService({ settingsStore: store });
  const app = createApp({ pool: database, config, aiRouter: createAiRouter({ assistant, settingsStore: store }) });
  const server = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  t.after(() => new Promise(resolve => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  const login = async email => {
    const response = await fetch(base + '/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password }) });
    assert.equal(response.status, 200); return (await response.json()).data.access_token;
  };
  const adminToken = await login(admin.email), staffToken = await login(staff.email);
  const request = (method, body, token = adminToken) => fetch(base + '/ai/settings', { method,
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}) });
  assert.equal((await request('GET', null, null)).status, 401);
  assert.equal((await request('GET', null, staffToken)).status, 403);
  assert.equal((await request('PATCH', { provider: { only: ['untrusted'] } }, staffToken)).status, 403);
  const routing = { only: ['provider-a', 'provider-b'], order: ['provider-b', 'provider-a'], quantizations: ['fp8', 'bf16'], require_parameters: true, allow_fallbacks: false };
  const saved = await request('PATCH', { provider: routing }); assert.equal(saved.status, 200);
  const adminView = (await saved.json()).data; assert.deepEqual(adminView.provider, routing);
  assert.equal(adminView.has_api_key, true); assert.equal(JSON.stringify(adminView).includes(originalSecret), false);
  assert.equal(JSON.stringify(adminView).includes(encrypted), false);
  assert.deepEqual((await new AiSettingsStore({ database, key }).readRuntime()).provider, routing);
  assert.equal((await bootstrapDatabase(database)).newlyApplied.length, 0);
  assert.deepEqual((await store.readAdmin()).provider, routing);
  const [[jsonType]] = await database.query('SELECT JSON_TYPE(provider) AS kind FROM yuncms_ai_settings'); assert.equal(jsonType.kind, 'OBJECT');
  for (const provider of [{ api_key: 'must-not-be-stored' }, { model: 'override' }, { only: [] }, { allow_fallbacks: 'true' }]) {
    assert.equal((await request('PATCH', { provider })).status, 400);
    assert.deepEqual((await store.readAdmin()).provider, routing);
  }

  const custom = 'https://private-compatible.example.test/llm/v1';
  assert.equal((await request('PATCH', { base_url: custom })).status, 400);
  assert.equal((await store.readRuntime()).baseUrl, 'https://api.openai.com/v1');
  assert.equal((await store.readRuntime()).apiKey, originalSecret);
  assert.equal((await request('PATCH', { base_url: 'https://api.openai.com/v1/' })).status, 200);
  assert.deepEqual((await store.readAdmin()).provider, routing);
  const changed = await request('PATCH', { base_url: custom, api_key: 'Synthetic-new-endpoint-key', model: 'arbitrary-vendor-model', enabled: false });
  assert.equal(changed.status, 200); const current = await store.readRuntime();
  assert.equal(current.baseUrl, custom); assert.equal(current.apiKey, 'Synthetic-new-endpoint-key');
  assert.equal(current.model, 'arbitrary-vendor-model'); assert.equal(current.provider, null);
  assert.equal((await request('PATCH', { provider: routing })).status, 200);
  assert.equal((await request('PATCH', { provider: null })).status, 200); assert.equal((await store.readRuntime()).provider, null);
  assert.equal((await request('PATCH', { base_url: 'http://127.0.0.1:8000/v1', clear_api_key: true, enabled: false })).status, 200);
  assert.equal((await store.readRuntime()).apiKey, null);
});

test('real compatible provider: native chat uses the chosen server routing while tools read only the ordinary user permitted data', {
  skip: process.env.YUNCMS_TEST_MYSQL !== '1', timeout: 180000,
}, async t => {
  assert.equal(process.env.YUNCMS_TEST_DB_ALLOW_DESTRUCTIVE, '1');
  assert.ok(process.env.YUNCMS_TEST_REAL_PROVIDER_FILE, 'An actual provider is required');
  const provider = JSON.parse(await readFile(process.env.YUNCMS_TEST_REAL_PROVIDER_FILE, 'utf8'));
  const config = loadConfig(process.env); assert.match(config.database.database, /(test|ci|dev)/i);
  const database = createDatabasePool(config.database); t.after(() => database.end());
  await bootstrapDatabase(database);
  const emitter = new HookEmitter(), options = { database, emitter, accountability: createSystemAccountability() };
  const collection = 'compatible_records_' + randomUUID().slice(0, 8), marker = 'content-' + randomUUID();
  await new CollectionsService(options).createOne({ collection });
  await new FieldsService(options).createOne(collection, { field: 'message', type: 'text' });
  const record = await new ItemsService(collection, options).createOne({ message: marker });
  const role = await new RolesService(options).createOne({ name: collection + ' reader' });
  const password = 'Compatible-provider-reader-123!';
  const actor = await new UsersService(options).createOne({ email: collection + '@example.test', role: role.id, password });
  await new PermissionsService(options).createOne({ role: role.id, collection, action: 'read', fields: ['id', 'message'] });
  const store = new AiSettingsStore({ database, key: randomBytes(32) });
  await store.update({ enabled: true, writes_enabled: false,
    base_url: provider.OPENROUTER_BASE_URL || provider.AI_BASE_URL,
    model: provider.AI_CHAT_MODEL, api_key: provider.OPENROUTER_API_KEY || provider.OPENROUTER_KEY || provider.AI_API_KEY,
    provider: provider.AI_PROVIDER_ROUTING ?? null });
  const started = [], completed = [];
  emitter.registerFilter('ai.provider.before', (payload, context) => {
    assert.equal(context.accountability.user, actor.id); assert.equal(context.accountability.admin, false);
    started.push(payload.call_id); return payload;
  });
  emitter.registerFilter('ai.provider.completed', (payload, context) => {
    assert.equal(context.accountability.user, actor.id); assert.ok(payload.usage.totalTokens > 0);
    completed.push(payload.call_id); return payload;
  });
  const assistant = new AiAssistantService({ settingsStore: store, emitter });
  const app = createApp({ pool: database, config, emitter, schemaCache: new SchemaCache({ versionCheckTtlMs: 0 }),
    aiRouter: createAiRouter({ assistant, settingsStore: store }) });
  const server = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  t.after(() => new Promise(resolve => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  const login = await fetch(base + '/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: actor.email, password }) });
  assert.equal(login.status, 200); const token = (await login.json()).data.access_token;
  const item = await fetch(base + `/items/${collection}/${record.id}`, { headers: { authorization: `Bearer ${token}` } });
  assert.equal(item.status, 200); assert.equal((await item.json()).data.message, marker);
  const response = await fetch(base + '/ai/chat', { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ messages: [{ role: 'user', content: `Read collection ${collection}, record id ${record.id}, and reply with its message field exactly. Use the native data tools; do not guess.` }],
      provider: { only: ['untrusted-client-provider'] }, model: 'untrusted-client-model', base_url: 'https://untrusted.invalid' }) });
  const body = await response.json(); assert.equal(response.status, 200, JSON.stringify(body));
  assert.ok(body.data.message.includes(marker), JSON.stringify(body.data));
  assert.ok(body.data.operations.some(operation => operation.success && operation.collection === collection && operation.operation.startsWith('items_')));
  assert.equal(body.data.writes_enabled, false); assert.ok(started.length >= 2);
  assert.deepEqual(completed, started); assert.equal((await new ItemsService(collection, options).readOne(record.id)).message, marker);
});
