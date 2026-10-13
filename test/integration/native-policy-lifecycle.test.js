import assert from 'node:assert/strict';
import test from 'node:test';
import { randomBytes, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { ExtensionError } from '@yunsoft/yuncms-extensions-sdk';
import {
  bootstrapDatabase, closeDatabasePool, CollectionsService, createCoreServiceRegistry,
  createDatabasePool, createPublicAccountability, createSystemAccountability, FieldsService, HookEmitter,
  ItemsService, loadConfig, RolesService, SchemaCache, UsersService,
} from '@yunsoft/yuncms-core';
import { createApp } from '../../packages/api/src/app.js';
import { AiAssistantService } from '../../packages/api/src/ai/service.js';
import { DEFAULT_AI_SETTINGS } from '../../packages/api/src/ai/config.js';
import { createAiRouter } from '../../packages/api/src/routes/ai.js';
import { AiSettingsStore } from '../../packages/api/src/ai/settings-store.js';

async function fixture(t) {
  const config = loadConfig(process.env);
  assert.equal(process.env.YUNCMS_TEST_DB_ALLOW_DESTRUCTIVE, '1');
  assert.match(config.database.database, /(test|ci|dev)/i);
  const database = createDatabasePool(config.database);
  t.after(() => closeDatabasePool(database));
  await bootstrapDatabase(database);
  const services = createCoreServiceRegistry().toObject(), emitter = new HookEmitter();
  const schemaCache = new SchemaCache({ versionCheckTtlMs: 0 });
  const options = { database, schemaCache, accountability: createSystemAccountability(), emitter };
  return { config, database, services, emitter, schemaCache, options };
}

test('real MySQL: single and bulk item filters share rollback-safe native transactions', {
  skip: process.env.YUNCMS_TEST_MYSQL !== '1', timeout: 60000,
}, async t => {
  const { database, emitter, options } = await fixture(t), key = randomUUID().slice(0, 8);
  const collection = `policy_items_${key}`, counter = `policy_counter_${key}`;
  const schema = new CollectionsService(options), fields = new FieldsService(options);
  await schema.createOne({ collection });
  await fields.createOne(collection, { field: 'name', type: 'string', required: true });
  await schema.createOne({ collection: counter });
  await fields.createOne(counter, { field: 'used', type: 'integer', required: true });
  const row = await new ItemsService(counter, options).createOne({ used: 0 });
  const seen = [], committed = [];
  let capacity = 2;
  emitter.registerAction('items.create', (payload, context) => { if (context.collection === collection) { assert.equal(context.transaction.state, 'committed'); committed.push(payload.item.name); } });
  for (const operation of ['create', 'update', 'delete']) emitter.registerFilter(`items.${operation}`, async (payload, context) => {
    if (context.collection !== collection) return payload;
    assert.equal(context.transaction?.managed, true);
    seen.push(operation);
    if (operation === 'create') {
      const [[state]] = await context.database.query(`SELECT used FROM ${counter} WHERE id = ? FOR UPDATE`, [row.id]);
      if (state.used >= capacity) throw new ExtensionError('CAPACITY_EXHAUSTED', 'No more item capacity.', { status: 403 });
      await context.database.query(`UPDATE ${counter} SET used = used + 1 WHERE id = ?`, [row.id]);
    }
    return payload;
  });
  const items = new ItemsService(collection, options);
  await assert.rejects(new ItemsService(collection, { ...options, accountability: createPublicAccountability() }).createOne({ name: 'Denied' }), error => error.code === 'FORBIDDEN');
  await assert.rejects(items.createOne({ nonexistent: true }));
  assert.equal((await new ItemsService(counter, options).readOne(row.id)).used, 0);
  await assert.rejects(items.createMany([{ name: 'rolled back' }, { nonexistent: true }]));
  assert.equal((await new ItemsService(counter, options).readOne(row.id)).used, 0);
  assert.deepEqual(committed, []);
  seen.length = 0;
  const created = await items.createMany([{ name: 'one' }, { name: 'two' }]);
  assert.equal(created.length, 2);
  assert.deepEqual(committed, ['one', 'two']);
  assert.equal((await new ItemsService(counter, options).readOne(row.id)).used, 2);
  await items.updateOne(created[0].id, { name: 'updated' });
  await items.updateMany({ id: { _eq: created[1].id } }, { name: 'bulk updated' });
  await items.deleteOne(created[0].id);
  await items.deleteMany({ id: { _eq: created[1].id } });
  assert.deepEqual(seen, ['create', 'create', 'update', 'update', 'delete', 'delete']);
  await new ItemsService(counter, options).updateOne(row.id, { used: 0 }); capacity = 1;
  const role = await new RolesService(options).createOne({ name: 'Concurrent admin ' + key, admin: true });
  const password = 'Disposable-concurrency-password!';
  const user = await new UsersService(options).createOne({ email: 'concurrent-' + key + '@example.test', password, role: role.id });
  const app = createApp({ pool: database, config: loadConfig(process.env), emitter, schemaCache: new SchemaCache({ versionCheckTtlMs: 0 }) });
  const server = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  t.after(() => new Promise(resolve => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  const login = await fetch(base + '/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: user.email, password }) });
  assert.equal(login.status, 200); const token = (await login.json()).data.access_token;
  const responses = await Promise.all(Array.from({ length: 4 }, (_, i) => fetch(base + '/items/' + collection, { method: 'POST', headers: { authorization: 'Bearer ' + token, 'content-type': 'application/json' }, body: JSON.stringify({ name: 'Concurrent ' + i }) })));
  assert.deepEqual(responses.map(r => r.status).sort(), [201, 403, 403, 403]);
  assert.equal((await new ItemsService(counter, options).readOne(row.id)).used, 1);
  assert.equal((await items.readMany()).length, 1);

});

test('real native API/provider: AI admission denies before work and exposes completion and failure lifecycles', {
  skip: process.env.YUNCMS_TEST_MYSQL !== '1', timeout: 180000,
}, async t => {
  const { config, database, services, emitter, schemaCache, options } = await fixture(t);
  let provider;
  if (process.env.YUNCMS_TEST_REAL_PROVIDER_FILE) {
    provider = JSON.parse(await readFile(process.env.YUNCMS_TEST_REAL_PROVIDER_FILE, 'utf8'));
  } else {
    const fixtureProvider = createServer(async (req, res) => {
      let raw = ''; for await (const chunk of req) raw += chunk;
      const request = JSON.parse(raw);
      res.setHeader('content-type', 'application/json');
      if (request.model.startsWith('invalid-model-')) { res.statusCode = 404; res.end(JSON.stringify({ error: { message: 'Unknown fixture model' } })); return; }
      res.end(JSON.stringify({ choices: [{ message: { role: 'assistant', content: 'OK' } }], usage: { total_tokens: 8 } }));
    });
    await new Promise(resolve => fixtureProvider.listen(0, '127.0.0.1', resolve));
    t.after(() => new Promise(resolve => fixtureProvider.close(resolve)));
    provider = { AI_API_KEY: 'local-fixture-key', AI_CHAT_MODEL: 'local-fixture', AI_BASE_URL: `http://127.0.0.1:${fixtureProvider.address().port}/v1` };
  }
  const password = 'Disposable-Policy-9173!', key = randomUUID().slice(0, 8);
  const role = await new RolesService(options).createOne({ name: `Policy admin ${key}`, admin: true });
  const user = await new UsersService(options).createOne({ email: `policy-${key}@example.test`, password, role: role.id });
  const settingsStore = new AiSettingsStore({ database, key: randomBytes(32) });
  const assistant = new AiAssistantService({ config: { ...DEFAULT_AI_SETTINGS, enabled: true,
    apiKey: provider.OPENROUTER_API_KEY || provider.OPENROUTER_KEY || provider.AI_API_KEY,
    model: provider.AI_CHAT_MODEL, baseUrl: provider.OPENROUTER_BASE_URL || provider.AI_BASE_URL || 'https://openrouter.ai/api/v1',
  }, emitter });
  const providerFailurePayloads = [];
  let deny = true, complete = 0, failed = 0, providerStarted = 0, providerCompleted = 0, providerFailed = 0;
  emitter.registerFilter('ai.provider.before', payload => { providerStarted++; assert.ok(payload.estimated_max_tokens > 0); assert.match(payload.call_id, /^[a-f0-9-]{36}$/); return payload; });
  emitter.registerFilter('ai.provider.completed', payload => { providerCompleted++; assert.ok(payload.usage.totalTokens >= 0); return payload; });
  emitter.registerAction('ai.provider.failed', payload => { providerFailed++; providerFailurePayloads.push(payload); });
  emitter.registerFilter('ai.chat.before', (payload, context) => {
    assert.equal(context.accountability.user, user.id);
    assert.equal(context.database, database);
    if (deny) throw new ExtensionError('AI_CAPACITY_EXHAUSTED', 'AI capacity is exhausted.', { status: 402 });
    return payload;
  });
  emitter.registerFilter('ai.chat.completed', payload => { complete++; assert.equal(typeof payload.message, 'string'); return payload; });
  emitter.registerAction('ai.chat.failed', () => { failed++; });
  const app = createApp({ pool: database, config, schemaCache, emitter,
    aiRouter: createAiRouter({ assistant, settingsStore }), serviceRegistry: createCoreServiceRegistry() });
  const server = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  t.after(() => new Promise(resolve => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  const login = await fetch(base + '/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: user.email, password }) });
  assert.equal(login.status, 200);
  const token = (await login.json()).data.access_token;
  const request = () => fetch(base + '/ai/chat', { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ messages: [{ role: 'user', content: 'Reply only OK. Do not call tools.' }] }) });
  assert.equal((await request()).status, 402);
  assert.equal(complete, 0);
  assert.equal(providerStarted, 0);
  deny = false;
  const response = await request();
  assert.equal(response.status, 200);
  assert.ok((await response.json()).data.message);
  assert.equal(complete, 1);
  assert.equal(providerStarted, 1);
  assert.equal(providerCompleted, 1);
  const remove = emitter.registerFilter('ai.chat.completed', () => { throw new ExtensionError('CONTROLLED_COMPLETION_FAILURE', 'Completion persistence unavailable.', { status: 409 }); });
  assert.equal((await request()).status, 409);
  assert.equal(failed, 2);
  remove();
  const removeProviderFailure = emitter.registerFilter('ai.provider.completed', () => { throw new ExtensionError('COMPLETION_STORAGE_UNAVAILABLE', 'Cannot settle usage.', { status: 409 }); });
  assert.equal((await request()).status, 409);
  assert.equal(providerFailurePayloads[0].provider_completed, true);
  assert.ok(providerFailurePayloads[0].usage.totalTokens > 0);
  removeProviderFailure();
  assistant.config.model = 'invalid-model-' + randomUUID();
  assert.equal((await request()).status, 502);
  assert.equal(providerStarted, 4);
  assert.equal(providerCompleted, 3);
  assert.equal(providerFailed, 2);
  assert.equal(providerFailurePayloads[1].provider_completed, false);
});
