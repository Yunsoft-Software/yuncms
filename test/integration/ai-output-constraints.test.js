import assert from 'node:assert/strict';
import test from 'node:test';
import { randomBytes, randomUUID, createHash } from 'node:crypto';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import {
  bootstrapDatabase, createDatabasePool, createAccountability, createSystemAccountability, createCoreServiceRegistry,
  CollectionsService, FieldsService, RolesService, UsersService, PermissionsService, ItemsService,
  HookEmitter, SchemaCache, loadConfig, applyMigrations, CORE_MIGRATIONS,
} from '@yunsoft/yuncms-core';
import { createApp } from '../../packages/api/src/app.js';
import { registerInternalAudit } from '../../packages/api/src/audit-hooks.js';
import { AiAssistantService } from '../../packages/api/src/ai/service.js';
import { AiSettingsStore } from '../../packages/api/src/ai/settings-store.js';
import { AiAutomationsService } from '../../packages/api/src/automations/service.js';
import { AiAutomationWorker } from '../../packages/api/src/automations/worker.js';
import { createAutomationsRouter } from '../../packages/api/src/routes/automations.js';

const enabled = process.env.YUNCMS_TEST_MYSQL === '1';
const hash = value => createHash('sha256').update(value, 'utf8').digest('hex');

test('real provider/native MySQL: declared output equality, observations and transaction boundaries', {
  skip: !enabled, timeout: 240000,
}, async t => {
  assert.equal(process.env.YUNCMS_TEST_DB_ALLOW_DESTRUCTIVE, '1');
  const config = loadConfig(process.env); assert.match(config.database.database, /(test|ci|dev)/i);
  assert.ok(process.env.YUNCMS_TEST_REAL_PROVIDER_FILE);
  const provider = JSON.parse(await readFile(process.env.YUNCMS_TEST_REAL_PROVIDER_FILE, 'utf8'));
  const database = createDatabasePool(config.database); t.after(() => database.end()); await bootstrapDatabase(database);
  const errors = [], logger = { error: (...args) => errors.push(args), warn() {} };
  const emitter = new HookEmitter({ logger }), schemaCache = new SchemaCache({ versionCheckTtlMs: 0 });
  const services = createCoreServiceRegistry().toObject(), owner = { database, emitter, schemaCache, accountability: createSystemAccountability(), logger };
  registerInternalAudit({ emitter, services, database, logger });
  const suffix = randomUUID().slice(0, 8), collection = 'constraint_' + suffix, password = 'Disposable-constraint-' + randomUUID() + '!';
  const adminRole = await new RolesService(owner).createOne({ name: 'Constraint admin ' + suffix, admin: true });
  const admin = await new UsersService(owner).createOne({ email: 'constraint-admin-' + suffix + '@example.test', password, role: adminRole.id });
  const role = await new RolesService(owner).createOne({ name: 'Constraint actor ' + suffix });
  const actor = await new UsersService(owner).createOne({ email: 'constraint-actor-' + suffix + '@example.test', password, role: role.id });
  await new CollectionsService(owner).createOne({ collection });
  for (const field of ['source_text', 'summary']) await new FieldsService(owner).createOne(collection, { field, type: 'text' });
  await new FieldsService(owner).createOne(collection, { field: 'hidden', type: 'text' });
  const permissions = new PermissionsService(owner);
  const readPermission = await permissions.createOne({ role: role.id, collection, action: 'read', fields: ['id', 'source_text', 'summary'] });
  const writePermission = await permissions.createOne({ role: role.id, collection, action: 'update', fields: ['summary'] });
  const key = randomBytes(32), settingsStore = new AiSettingsStore({ database, key });
  await settingsStore.update({ enabled: true, writes_enabled: true, api_key: provider.OPENROUTER_API_KEY || provider.OPENROUTER_KEY || provider.AI_API_KEY,
    model: provider.AI_CHAT_MODEL, base_url: provider.OPENROUTER_BASE_URL || provider.AI_BASE_URL, provider: provider.AI_PROVIDER_ROUTING ?? null });
  const observations = [], observationContexts = [], admission = []; let onCompleted = null, frozenWritesRejected = 0;
  emitter.registerFilter('ai.provider.before', (payload, context) => {
    assert.equal(context.accountability.user, actor.id); assert.equal(context.accountability.admin, false); admission.push(payload.call_id); return payload;
  });
  emitter.registerFilter('ai.provider.completed', async payload => { if (onCompleted) { const fn = onCompleted; onCompleted = null; await fn(); } return payload; });
  emitter.registerAction('ai.provider.observed', async (payload, context) => {
    observations.push(payload); observationContexts.push({ user: context.accountability.user, admin: context.accountability.admin });
    assert.equal(context.accountability.user, actor.id); assert.equal(Object.isFrozen(payload), true);
    assert.equal(Object.hasOwn(payload, 'headers'), false); assert.equal(Object.hasOwn(payload, 'api_key'), false);
    assert.equal(payload.body === null || hash(payload.body) === payload.body_sha256, true);
    if (process.env.YUNCMS_TEST_AI_OBSERVATION_DIR) {
      const root = process.env.YUNCMS_TEST_AI_OBSERVATION_DIR;
      await mkdir(root, { recursive: true, mode: 0o700 });
      await writeFile(root + '/' + payload.call_id + '-' + payload.phase + '.private.json', JSON.stringify(payload), { mode: 0o600 });
    }
    // A real trusted observation action cannot turn its return value into output.
    return { body: 'ignored observation result' };
  });
  emitter.registerAction('ai.provider.observed', () => { throw new Error('Synthetic observer body must stay private'); });
  emitter.registerAction('ai.provider.observed', payload => {
    try { payload.body = 'must not replace the native response'; } catch { frozenWritesRejected++; }
  });
  const assistant = new AiAssistantService({ settingsStore, emitter, logger, providerObservationsEnabled: true });
  const automationOptions = { assistant, settingsStore, schemaCache };
  const manager = createAccountability({ user: admin.id, role: adminRole.id, admin: true });
  const service = new AiAutomationsService({ ...owner, ...automationOptions, services, accountability: manager });
  const items = new ItemsService(collection, owner), worker = new AiAutomationWorker(service);
  for (const event of ['items.create', 'items.update']) emitter.registerAction(event, (payload, context) => service.enqueue(event, payload, context));
  const app = createApp({ pool: database, config, emitter, schemaCache, logger, automationsRouter: createAutomationsRouter(automationOptions) });
  const server = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  t.after(() => new Promise(resolve => server.close(resolve)));
  const base = 'http://127.0.0.1:' + server.address().port;
  async function login(email) { const r = await fetch(base + '/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password }) }); assert.equal(r.status, 200); return (await r.json()).data.access_token; }
  const adminToken = await login(admin.email), actorToken = await login(actor.email);
  const headers = { authorization: 'Bearer ' + adminToken, 'content-type': 'application/json' };
  async function request(path, body, token = adminToken, method = 'POST') { return fetch(base + path, { method, headers: { 'content-type': 'application/json', ...(token ? { authorization: 'Bearer ' + token } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }); }
  const baseRule = { name: 'Explicit copy', collection, run_as: actor.id, enabled: true, on_create: false, on_update: true,
    input_fields: ['source_text'], output_fields: ['summary'], instruction: 'Copy source_text verbatim into summary. Return a JSON object containing only the summary key.',
    output_constraints: { summary: { must_equal_input: 'source_text' } } };
  async function fixture() { const source = ' owned native-json-' + randomUUID() + ' Türkçe 日本語 🙂\nend '; const record = await items.createOne({ source_text: source, summary: 'Original summary', hidden: 'private' }); const rule = await service.save(baseRule); return { record, rule, source }; }
  async function auditCount() { const [[r]] = await database.query('SELECT COUNT(*) AS total FROM yuncms_audit_log WHERE collection=?', [collection]); return Number(r.total); }
  async function readSql(id) { const [r] = await database.query('SELECT source_text,summary FROM `' + collection + '` WHERE id=?', [id]); return r[0]; }
  async function latest(rule) { return (await service.runs(rule.id))[0]; }

  await t.test('API validates bindings and Run as field boundaries before contacting a provider', async () => {
    for (const output_constraints of [null, { summary: { must_equal_input: 'hidden' } }, { hidden: { must_equal_input: 'source_text' } }, { summary: { must_equal_input: 'source_text', repair: true } }]) {
      const r = await request('/automations', { ...baseRule, output_constraints }); assert.equal(r.status, 400);
    }
    assert.equal((await request('/automations', baseRule, actorToken)).status, 403);
    assert.equal((await request('/automations', baseRule, null)).status, 401);
    const before = observations.length;
    await permissions.updateOne(readPermission.id, { fields: ['id', 'summary'] });
    assert.equal((await request('/automations', baseRule)).status, 403);
    await permissions.updateOne(readPermission.id, { fields: ['id', 'source_text', 'summary'] });
    await permissions.updateOne(writePermission.id, { fields: ['hidden'] });
    assert.equal((await request('/automations', baseRule)).status, 403);
    await permissions.updateOne(writePermission.id, { fields: ['summary'] });
    assert.equal(observations.length, before);
  });

  await t.test('preview is read-only and strict schema/native/proposed values share exact bytes', async () => {
    const { record, rule, source } = await fixture();
    try {
      const audit = await auditCount(), start = observations.length;
      const r = await request('/automations/preview', { rule: baseRule, item_key: String(record.id) });
      assert.equal(r.status, 200); const body = await r.json();
      assert.equal(hash(body.data.proposed.summary), hash(source)); assert.equal((await readSql(record.id)).summary, 'Original summary'); assert.equal(await auditCount(), audit);
      const [sent, received] = observations.slice(start); assert.equal(sent.phase, 'request'); assert.equal(received.phase, 'response'); assert.equal(sent.call_id, received.call_id);
      const wire = JSON.parse(sent.body), raw = JSON.parse(JSON.parse(received.body).choices[0].message.content);
      assert.equal(wire.response_format.type, 'json_schema'); assert.equal(wire.response_format.json_schema.strict, true);
      assert.equal(hash(wire.response_format.json_schema.schema.properties.summary.enum[0]), hash(source));
      assert.equal(hash(raw.summary), hash(body.data.proposed.summary));
      assert.equal(JSON.stringify(errors).includes('Synthetic observer body must stay private'), false);
      assert.equal(admission.includes(sent.call_id), true);
    } finally { await service.remove(rule.id); }
  });

  await t.test('default-off observations expose no body while the same native generation still works', async () => {
    const { record, rule, source } = await fixture();
    try {
      const silent = new AiAutomationsService({ ...owner, services, settingsStore, accountability: manager,
        assistant: new AiAssistantService({ settingsStore, emitter, logger }) });
      const before = observations.length, result = await silent.preview(baseRule, String(record.id));
      assert.equal(hash(result.proposed.summary), hash(source)); assert.equal(observations.length, before);
      assert.equal((await readSql(record.id)).summary, 'Original summary');
    } finally { await service.remove(rule.id); }
  });

  await t.test('a stalled observation action cannot block a real native preview', async () => {
    const { record, rule, source } = await fixture(); let release, entered = false, finished = false;
    const held = new Promise(resolve => { release = resolve; });
    const remove = emitter.registerAction('ai.provider.observed', async payload => {
      if (payload.phase === 'response') { entered = true; await held; finished = true; }
    });
    try {
      const r = await request('/automations/preview', { rule: baseRule, item_key: String(record.id) });
      assert.equal(r.status, 200); assert.equal(hash((await r.json()).data.proposed.summary), hash(source));
      assert.equal(entered, true); assert.equal(finished, false);
      assert.equal((await readSql(record.id)).summary, 'Original summary');
    } finally { release(); remove(); await service.remove(rule.id); }
  });

  await t.test('nullable text equality preserves a real null value without string coercion', async () => {
    const { record, rule } = await fixture();
    try {
      await items.updateOne(record.id, { source_text: null }); await worker.tick();
      const run = await latest(rule); assert.equal(run.status, 'succeeded'); assert.equal(run.attempts, 1);
      assert.equal((await readSql(record.id)).summary, null);
    } finally { await service.remove(rule.id); }
  });

  await t.test('older PUT clients preserve bindings, explicit removal works, restart reads the same revision', async () => {
    const { rule } = await fixture();
    try {
      const legacy = { ...baseRule, name: 'Legacy edit' }; delete legacy.output_constraints;
      const r = await request('/automations/' + rule.id, legacy, adminToken, 'PUT'); assert.equal(r.status, 200);
      const saved = (await r.json()).data; assert.deepEqual(saved.output_constraints, baseRule.output_constraints); assert.equal(saved.revision, rule.revision + 1);
      const restarted = new AiAutomationsService({ ...owner, services, assistant: new AiAssistantService({ settingsStore: new AiSettingsStore({ database, key }), emitter }), settingsStore, schemaCache: new SchemaCache() });
      assert.deepEqual((await restarted.read(rule.id)).output_constraints, baseRule.output_constraints);
      assert.equal((await request('/automations/' + rule.id, { ...legacy, input_fields: ['hidden'] }, adminToken, 'PUT')).status, 400);
      assert.deepEqual((await service.read(rule.id)).output_constraints, baseRule.output_constraints);
      const clear = await request('/automations/' + rule.id, { ...baseRule, output_constraints: {} }, adminToken, 'PUT'); assert.equal(clear.status, 200); assert.deepEqual((await clear.json()).data.output_constraints, {});
    } finally { await service.remove(rule.id); }
  });

  await t.test('worker commits a constrained value once and a fresh worker does not repeat it', async () => {
    const { record, rule } = await fixture(); const source = 'next native-json-' + randomUUID();
    try { await items.updateOne(record.id, { source_text: source }); await worker.tick();
      const run = await latest(rule); assert.equal(run.status, 'succeeded'); assert.equal(run.attempts, 1);
      assert.equal(hash((await readSql(record.id)).summary), hash(source)); const calls = admission.length;
      await new AiAutomationWorker(service).tick(); assert.equal(admission.length, calls);
      assert.equal(hash((await new ItemsService(collection, { ...owner, schemaCache: new SchemaCache() }).readOne(record.id)).summary), hash(source));
    } finally { await service.remove(rule.id); }
  });

  await t.test('native mutation-filter mismatch rolls back SQL/audit and remains terminal at attempt one', async () => {
    const { record, rule } = await fixture(); const remove = emitter.registerFilter('items.update', (payload, context) => context.collection === collection && context.requestId?.startsWith('ai-automation:')
      ? { ...payload, summary: 'deliberately different native filter output' } : payload);
    try { await items.updateOne(record.id, { source_text: 'queued native-json-' + randomUUID() }); const audit = await auditCount(); await worker.tick();
      const run = await latest(rule); assert.equal(run.status, 'failed'); assert.equal(run.error_code, 'AI_OUTPUT_CONSTRAINT_FAILED'); assert.equal(run.attempts, 1);
      assert.equal((await readSql(record.id)).summary, 'Original summary'); assert.equal(await auditCount(), audit);
      const calls = admission.length; await worker.tick(); assert.equal(admission.length, calls); assert.equal((await latest(rule)).attempts, 1);
    } finally { remove(); await service.remove(rule.id); }
  });

  await t.test('rule revision changed during generation skips the original worker write', async () => {
    const { record, rule } = await fixture();
    try { await items.updateOne(record.id, { source_text: 'revision native-json-' + randomUUID() }); onCompleted = () => service.save({ ...baseRule, name: 'Revised while generating' }, rule.id); await worker.tick();
      assert.equal((await latest(rule)).status, 'skipped'); assert.equal((await readSql(record.id)).summary, 'Original summary');
    } finally { onCompleted = null; await service.remove(rule.id); }
  });

  await t.test('source changed during generation survives and cannot be overwritten with the old snapshot', async () => {
    const { record, rule } = await fixture(), concurrent = 'concurrent native-json-' + randomUUID();
    try { await items.updateOne(record.id, { source_text: 'snapshot native-json-' + randomUUID() }); onCompleted = () => items.updateOne(record.id, { source_text: concurrent }); await worker.tick();
      const runs = await service.runs(rule.id); assert.equal(runs.some(r => r.status === 'skipped'), true);
      assert.equal(hash((await readSql(record.id)).source_text), hash(concurrent)); assert.equal((await readSql(record.id)).summary, 'Original summary');
    } finally { onCompleted = null; await service.remove(rule.id); }
  });

  await t.test('revoked output permission after generation fails before the worker mutation', async () => {
    const { record, rule } = await fixture();
    try { await items.updateOne(record.id, { source_text: 'permission native-json-' + randomUUID() }); onCompleted = () => permissions.updateOne(writePermission.id, { fields: ['hidden'] }); await worker.tick();
      const run = await latest(rule); assert.equal(run.status, 'failed'); assert.equal(run.error_code, 'FORBIDDEN_FIELD'); assert.equal(run.attempts, 1);
      assert.equal((await readSql(record.id)).summary, 'Original summary');
    } finally { onCompleted = null; await permissions.updateOne(writePermission.id, { fields: ['summary'] }); await service.remove(rule.id); }
  });
  assert.equal(frozenWritesRejected, observations.length);
  for (const payload of observations) {
    assert.equal(Object.isFrozen(payload), true);
    assert.equal(Object.hasOwn(payload, 'headers'), false); assert.equal(Object.hasOwn(payload, 'api_key'), false);
    assert.equal(payload.body === null || hash(payload.body) === payload.body_sha256, true);
  }
  assert.equal(observationContexts.every(context => context.user === actor.id && context.admin === false), true);
  assert.equal(JSON.stringify(errors).includes('Synthetic observer body must stay private'), false);
  await settingsStore.update({ enabled: false, clear_api_key: true });
});

test('real MySQL: 0026 upgrades a legacy rule without changing its value, flags or revision', { skip: !enabled, timeout: 60000 }, async t => {
  assert.equal(process.env.YUNCMS_TEST_DB_ALLOW_DESTRUCTIVE, '1'); const config = loadConfig(process.env);
  const root = createDatabasePool(config.database); t.after(() => root.end());
  const name = 'yuncms_constraint_migration_test_' + randomUUID().replaceAll('-', '').slice(0, 8);
  await root.query('CREATE DATABASE `' + name + '` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci');
  const database = createDatabasePool({ ...config.database, database: name }); t.after(() => database.end());
  await applyMigrations(database, CORE_MIGRATIONS.slice(0, -1));
  const owner = { database, accountability: createSystemAccountability() };
  const role = await new RolesService(owner).createOne({ name: 'Legacy actor' }); const actor = await new UsersService(owner).createOne({ email: 'legacy-constraint@example.test', password: 'Disposable-migration-constraints-123!', role: role.id });
  await new CollectionsService(owner).createOne({ collection: 'legacy_constraints' });
  for (const field of ['source', 'summary']) await new FieldsService(owner).createOne('legacy_constraints', { field, type: 'text' });
  const id = randomUUID(); await database.query('INSERT INTO yuncms_ai_automations (id,name,collection,run_as,enabled,on_create,on_update,input_fields,output_fields,instruction,revision) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
    [id, 'Legacy unchanged', 'legacy_constraints', actor.id, 1, 0, 1, '["source"]', '["summary"]', 'Legacy instruction', 7]);
  const result = await bootstrapDatabase(database); assert.deepEqual(result.newlyApplied, ['0026-ai-output-constraints']);
  const [[row]] = await database.query('SELECT * FROM yuncms_ai_automations WHERE id=?', [id]);
  assert.equal(row.output_constraints, null); assert.equal(row.name, 'Legacy unchanged'); assert.equal(row.revision, 7); assert.equal(row.enabled, 1); assert.equal(row.on_create, 0); assert.equal(row.on_update, 1);
  const service = new AiAutomationsService({ ...owner, services: createCoreServiceRegistry().toObject() });
  assert.deepEqual((await service.read(id)).output_constraints, {});
});
