import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { readFileSync, readdirSync } from 'node:fs';
import {
  bootstrapDatabase, CollectionsService, createAccountability, createCoreServiceRegistry, createDatabasePool,
  createStorageRegistry, createSystemAccountability, FieldsService, FlowsService, HookEmitter, ItemsService,
  loadConfig, LocalStorageDriver, PermissionsService, RolesService, SchemaCache, SmtpMailer, UsersService,
} from '@yunsoft/yuncms-core';
import { createApp } from '../../packages/api/src/app.js';
import { FlowRuntime } from '../../packages/api/src/flows/runtime.js';

const node = (id, type, options = {}, extra = {}) => ({ id, key: id, name: id, type, options, position: { x: 350, y: 100 }, resolve: null, reject: null, ...extra });
const definition = (operations, extra = {}) => ({ name: 'Integration flow', status: 'active', trigger: 'manual', accountability: 'trigger', options: { response: '$last' }, entry: operations[0]?.id ?? null, operations, ...extra });

test('native Flows API, graph execution, event transactions and durable jobs enforce real MySQL boundaries', {
  skip: process.env.YUNCMS_TEST_MYSQL !== '1', timeout: 120000,
}, async t => {
  const config = loadConfig(process.env);
  assert.equal(process.env.YUNCMS_TEST_DB_ALLOW_DESTRUCTIVE, '1'); assert.match(config.database.database, /(test|ci|dev)/i);
  const pool = createDatabasePool({ ...config.database, connectionLimit: 3 });
  const system = createSystemAccountability(), basic = { database: pool, accountability: system };
  const run = randomBytes(5).toString('hex'), articles = `it_flow_articles_${run}`, notes = `it_flow_notes_${run}`;
  const root = await mkdtemp(join(tmpdir(), 'yuncms-flows-'));
  const storage = createStorageRegistry({ local: new LocalStorageDriver({ root }) });
  const cache = new SchemaCache({ versionCheckTtlMs: 0 }), logger = { info() {}, warn() {}, error() {} }, emitter = new HookEmitter({ logger });
  const services = createCoreServiceRegistry().toObject(), roleIds = [], userIds = [], flowIds = [];
  let server, runtime;
  t.after(async () => {
    await runtime?.stop();
    if (server) await new Promise(resolve => server.close(resolve));
    for (const id of flowIds) await pool.query('DELETE FROM yuncms_flows WHERE id = ?', [id]);
    for (const collection of [notes, articles]) {
      await pool.query(`DROP TABLE IF EXISTS \`${collection}\``);
      await pool.query('DELETE FROM yuncms_collections WHERE collection = ?', [collection]);
    }
    for (const id of userIds) await pool.query('DELETE FROM yuncms_users WHERE id = ?', [id]);
    for (const id of roleIds) { await pool.query('DELETE FROM yuncms_permissions WHERE role = ?', [id]); await pool.query('DELETE FROM yuncms_roles WHERE id = ?', [id]); }
    await pool.end(); await rm(root, { recursive: true, force: true });
  });
  await bootstrapDatabase(pool);
  const roles = new RolesService(basic), users = new UsersService(basic);
  const adminRole = await roles.createOne({ name: `Flow admin ${run}`, admin: true }); roleIds.push(adminRole.id);
  const staffRole = await roles.createOne({ name: `Flow staff ${run}` }); roleIds.push(staffRole.id);
  const password = `Flow-fixture-${run}-Pass!`;
  const admin = await users.createOne({ email: `flow-admin-${run}@example.test`, password, role: adminRole.id }); userIds.push(admin.id);
  const staff = await users.createOne({ email: `flow-staff-${run}@example.test`, password, role: staffRole.id }); userIds.push(staff.id);
  for (const collection of [articles, notes]) {
    await new CollectionsService(basic).createOne({ collection, systemFields: ['created_by'] });
    await new FieldsService(basic).createOne(collection, { field: 'title', type: 'string' });
    await new FieldsService(basic).createOne(collection, { field: 'status', type: 'string' });
    await new FieldsService(basic).createOne(collection, { field: 'private_note', type: 'string' });
  }
  const schema = await cache.get(pool);
  const permissions = new PermissionsService({ ...basic, schema });
  for (const action of ['read', 'create', 'update']) await permissions.createOne({ role: staffRole.id, collection: articles, action,
    fields: action === 'read' ? ['id', 'title', 'status', 'created_by'] : ['title', 'status'], ...(action === 'read' ? { filter: { created_by: { _eq: '$CURRENT_USER' } } } : {}) });
  const adminActor = createAccountability({ user: admin.id, role: adminRole.id, admin: true });
  const messages = [];
  const mailer = new SmtpMailer({ from: 'flows@example.test', emitter, transport: { async sendMail(message) { messages.push(message); return { messageId: 'local-fixture' }; } } });
  const shared = { database: pool, schemaCache: cache, services, emitter, storage, logger, mailer };
  const manager = new FlowsService({ ...shared, accountability: adminActor });
  const internal = new FlowsService({ ...shared, accountability: system });
  runtime = new FlowRuntime(shared).registerHooks();
  emitter.registerFilter('items.create', (payload, context) => {
    if (context.collection === articles && payload.title === 'native-denied') throw Object.assign(new Error('Native guard'), { code: 'FORBIDDEN' });
    return payload;
  });
  const app = createApp({ pool, config, schemaCache: cache, storage, emitter, logger, flowsOptions: { mailer } });
  server = await new Promise(resolve => { const instance = app.listen(0, '127.0.0.1', () => resolve(instance)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const request = async (path, token, method = 'GET', body) => {
    const response = await fetch(base + path, { method, headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...(body !== undefined ? { 'content-type': 'application/json' } : {}) }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
    return { status: response.status, body: response.status === 204 ? null : await response.json() };
  };
  const login = async user => { const response = await request('/auth/login', null, 'POST', { email: user.email, password }); assert.equal(response.status, 200); return response.body.data.access_token; };
  const adminToken = await login(admin), staffToken = await login(staff);
  const create = async input => { const flow = await manager.save(input); flowIds.push(flow.id); return flow; };
  const count = async collection => { const [[row]] = await pool.query(`SELECT COUNT(*) AS total FROM \`${collection}\``); return Number(row.total); };
  t.beforeEach(async () => { for (const id of flowIds) await pool.query('DELETE FROM yuncms_flows WHERE id = ?', [id]); });

  await t.test('administration, raw system access and parameterized identifiers deny unauthorized callers', async () => {
    for (const token of [null, staffToken]) {
      assert.equal((await request('/flows', token)).status, 403);
      assert.equal((await request('/flows/configuration', token)).status, 403);
      assert.equal((await request('/flows', token, 'POST', {})).status, 403);
      assert.ok([403, 404].includes((await request('/items/yuncms_flows', token)).status));
    }
    assert.equal((await request('/flows', adminToken)).status, 200);
    assert.equal((await request(`/flows/${encodeURIComponent("' OR 1=1 --")}`, adminToken)).status, 404);
    const configResponse = await request('/flows/configuration', adminToken);
    assert.equal(configResponse.status, 200); assert.equal(configResponse.body.data.operations.length, 12);
  });
  await t.test('Studio read-only metadata exposes granted collections and fields while keeping schema management private', async () => {
    const visible = await request('/studio-navigation/collections', staffToken);
    assert.equal(visible.status, 200); assert.deepEqual(visible.body.data.map(entry => entry.collection), [articles]);
    const fields = await request(`/studio-navigation/collections/${articles}/fields`, staffToken);
    assert.equal(fields.status, 200); assert.deepEqual(fields.body.data.map(entry => entry.field).sort(), ['created_by', 'id', 'status', 'title']);
    assert.equal((await request(`/studio-navigation/collections/${notes}/fields`, staffToken)).status, 403);
    assert.equal((await request('/studio-navigation/collections', null)).status, 401);
    assert.equal((await request('/studio-navigation/collections/yuncms_users/fields', staffToken)).status, 404);
    assert.equal((await request('/schema/collections', staffToken)).status, 403);
    assert.equal((await request('/schema/collections', staffToken, 'POST', { collection: 'must_not_exist' })).status, 403);
    assert.equal((await request(`/items/${articles}`, staffToken)).status, 200);
  });
  await t.test('manual graph CRUD preserves coordinates, typed output and optimistic revision boundaries', async () => {
    const draft = definition([node('output', 'transform', { value: '{{ $trigger.body.value }}' })], { status: 'inactive' });
    const created = await request('/flows', adminToken, 'POST', draft); assert.equal(created.status, 201); flowIds.push(created.body.data.id);
    let flow = created.body.data;
    assert.deepEqual(flow.operations[0].position, { x: 350, y: 100 });
    assert.equal((await request(`/flows/${flow.id}/run`, adminToken, 'POST', { body: { value: 7 } })).status, 409);
    const active = await request(`/flows/${flow.id}`, adminToken, 'PUT', { ...flow, status: 'active' }); assert.equal(active.status, 200); flow = active.body.data;
    const result = await request(`/flows/${flow.id}/run`, adminToken, 'POST', { body: { value: { nested: [7, false] } } });
    assert.equal(result.status, 200); assert.deepEqual(result.body.data.output, { nested: [7, false] });
    const raced = await Promise.all(['first', 'second'].map(name => request(`/flows/${flow.id}`, adminToken, 'PUT', { ...flow, name })));
    assert.deepEqual(raced.map(r => r.status).sort(), [200, 409]);
    assert.equal((await request(`/flows/${flow.id}?revision=${flow.revision}`, adminToken, 'DELETE')).status, 409);
    const latest = raced.find(r => r.status === 200).body.data;
    assert.equal((await request(`/flows/${flow.id}?revision=${latest.revision}`, adminToken, 'DELETE')).status, 204);
    const [[runs]] = await pool.query('SELECT COUNT(*) AS total FROM yuncms_flow_runs WHERE flow_id = ?', [flow.id]); assert.equal(Number(runs.total), 0);
  });
  await t.test('HTTP-triggered email uses configured native SMTP and preserves native mail filter authority', async () => {
    const rule = await create(definition([node('mail', 'mail', { to: 'reader@example.test', subject: 'Hello', text: 'Local fixture only' })]));
    const unsubscribe = emitter.registerFilter('mail.send', (payload, context) => { assert.equal(context.accountability.user, admin.id); assert.equal(context.accountability.admin, true); return payload; });
    try {
      const result = await request(`/flows/${rule.id}/run`, adminToken, 'POST', {});
      assert.equal(result.status, 200); assert.equal(result.body.data.output, null);
      assert.equal(messages.length, 1); assert.equal(messages[0].to, 'reader@example.test');
    } finally { unsubscribe(); }
    const reject = emitter.registerFilter('mail.send', () => { throw Object.assign(new Error('Native mail guard'), { code: 'FORBIDDEN' }); });
    try { assert.equal((await request(`/flows/${rule.id}/run`, adminToken, 'POST', {})).status, 403); assert.equal(messages.length, 1); }
    finally { reject(); }
  });
  await t.test('downloadable documentation recipes import through HTTP and execute their advertised native behavior', async () => {
    const root = new URL('../../docs/examples/flows/', import.meta.url), examples = new Map();
    for (const name of readdirSync(root).filter(name => name.endsWith('.json'))) {
      const input = JSON.parse(readFileSync(new URL(name, root), 'utf8').replaceAll('"articles"', JSON.stringify(articles))
        .replaceAll('11111111-1111-4111-8111-111111111111', staffRole.id).replaceAll('33333333-3333-4333-8333-333333333333', staff.id));
      const response = await request('/flows', adminToken, 'POST', input);
      assert.equal(response.status, 201, name); assert.equal(response.body.data.status, 'inactive', name);
      examples.set(name, response.body.data); flowIds.push(response.body.data.id);
    }
    assert.equal(examples.size, 8);
    const activate = async name => {
      const response = await request(`/flows/${examples.get(name).id}`, adminToken, 'PUT', { ...examples.get(name), status: 'active' });
      assert.equal(response.status, 200); examples.set(name, response.body.data); return response.body.data;
    };
    const greeting = await activate('manual-greeting.json');
    assert.deepEqual((await request(`/flows/${greeting.id}/run`, adminToken, 'POST', { body: { name: 'YunCMS' } })).body.data.output, { message: 'Hello YunCMS' });
    const branching = await activate('approval-branches.json');
    for (const approved of [false, true]) assert.deepEqual((await request(`/flows/${branching.id}/run`, adminToken, 'POST', { body: { approved } })).body.data.output, { decision: approved ? 'approved' : 'needs_review', accepted: approved });
    const review = await activate('manual-content-review.json');
    const record = await request(`/items/${articles}`, staffToken, 'POST', { title: 'Documented article', status: 'draft' }); assert.equal(record.status, 201);
    const result = await request(`/flows/${review.id}/run`, staffToken, 'POST', { collection: articles, keys: [record.body.data.id], body: {} });
    assert.equal(result.status, 200); assert.equal(result.body.data.output[0].status, 'review');
    assert.equal((await request(`/flows/${review.id}/run`, staffToken, 'POST', { collection: articles, keys: [] })).status, 400);
    assert.equal((await request(`/flows/${review.id}/run`, null, 'POST', { collection: articles, keys: [record.body.data.id] })).status, 403);
    await activate('event-title-required.json');
    const before = await count(articles);
    const rejected = await request(`/items/${articles}`, staffToken, 'POST', { title: '' });
    assert.equal(rejected.status, 422); assert.equal(rejected.body.errors[0].code, 'ARTICLE_TITLE_REQUIRED'); assert.equal(await count(articles), before);
    const webhook = await activate('webhook-greeting.json');
    assert.equal((await request(`/flows/trigger/${webhook.id}`, null, 'POST', { name: 'YunCMS' })).status, 403);
    assert.deepEqual((await request(`/flows/trigger/${webhook.id}`, adminToken, 'POST', { name: 'YunCMS' })).body.data.output, { message: 'Hello YunCMS' });
    const child = await activate('child-normalize.json'), parent = examples.get('parent-batch.json');
    parent.operations[0].options.flow = child.id;
    const batch = await activate('parent-batch.json');
    assert.deepEqual((await request(`/flows/${batch.id}/run`, adminToken, 'POST', { body: { rows: [{ name: 'Ada' }, { name: 'Lin' }] } })).body.data.output, [{ name: 'Ada' }, { name: 'Lin' }]);
    const schedule = await activate('schedule-read.json');
    await runtime.tick(new Date('2026-10-15T08:00:00Z'));
    const runs = await manager.readRuns(schedule.id); assert.equal(runs.length, 1); assert.equal(runs[0].status, 'succeeded');
    assert.ok(runs[0].output.some(item => item.id === record.body.data.id && item.status === 'review'));
  });
  await t.test('run-as preserves native field, row and hook boundaries for allowed manual roles', async () => {
    const rule = await create(definition([node('create', 'create', { collection: articles, payload: { title: 'Scoped record' } })], { accountability: 'user', run_as: staff.id, options: { response: '$last', allowed_roles: [staffRole.id], collections: [articles] } }));
    assert.equal((await request(`/flows/${rule.id}/run`, null, 'POST', { collection: articles })).status, 403);
    const result = await request(`/flows/${rule.id}/run`, staffToken, 'POST', { collection: articles });
    assert.equal(result.status, 200); assert.equal(result.body.data.output[0].created_by, staff.id);
    const id = result.body.data.output[0].id;
    const denied = await create(definition([node('update', 'update', { collection: articles, ids: [id], payload: { private_note: 'forbidden' } })], { accountability: 'user', run_as: staff.id }));
    assert.equal((await request(`/flows/${denied.id}/run`, adminToken, 'POST', {})).status, 403);
    const guarded = await create(definition([node('create', 'create', { collection: articles, payload: { title: 'native-denied' }, emit_events: false })], { accountability: 'user', run_as: staff.id }));
    const before = await count(articles);
    assert.equal((await request(`/flows/${guarded.id}/run`, adminToken, 'POST', {})).status, 403); assert.equal(await count(articles), before);
    assert.equal((await manager.readRuns(guarded.id))[0].status, 'failed');
  });
  await t.test('filter transforms join the originating write and native validation runs afterwards', async () => {
    await create(definition([node('transform', 'transform', { value: { title: 'Converted {{ $trigger.payload.title }}' } })], { trigger: 'event', options: { mode: 'filter', events: ['items.create'], collections: [articles], response: '$last' } }));
    const created = await request(`/items/${articles}`, staffToken, 'POST', { title: 'Draft' });
    assert.equal(created.status, 201); assert.equal(created.body.data.title, 'Converted Draft'); assert.equal(created.body.data.created_by, staff.id);
  });
  await t.test('filter rejection rolls back original mutation, earlier native writes and transactional logs', async () => {
    const rule = await create(definition([
      node('reservation', 'create', { collection: notes, payload: { title: 'Rollback reservation' } }, { resolve: 'deny' }),
      node('deny', 'error', { code: 'FLOW_BUSINESS_DENIED', status: 403, message: 'Denied by policy' }),
    ], { trigger: 'event', accountability: 'system', options: { mode: 'filter', events: ['items.create'], collections: [articles] } }));
    const before = [await count(articles), await count(notes)];
    const result = await request(`/items/${articles}`, staffToken, 'POST', { title: 'Blocked original' });
    assert.equal(result.status, 403); assert.equal(result.body.errors[0].code, 'FLOW_BUSINESS_DENIED');
    assert.deepEqual([await count(articles), await count(notes)], before);
    assert.equal((await manager.readRuns(rule.id)).length, 0);
  });
  await t.test('action queues after commit, records each node and skips a superseded definition', async () => {
    const rule = await create(definition([node('note', 'create', { collection: notes, payload: { title: 'After commit' } })], { trigger: 'event', accountability: 'system', options: { mode: 'action', events: ['items.create'], collections: [articles] } }));
    const before = await count(notes);
    assert.equal((await request(`/items/${articles}`, staffToken, 'POST', { title: 'Queued' })).status, 201);
    assert.equal(await count(notes), before); assert.equal((await manager.readRuns(rule.id))[0].status, 'pending');
    await internal.runNext(); assert.equal(await count(notes), before + 1);
    assert.equal((await manager.readRuns(rule.id))[0].trace[0].key, 'note');
    assert.equal((await request(`/items/${articles}`, staffToken, 'POST', { title: 'Stale' })).status, 201);
    await manager.save({ ...rule, name: 'New revision' }, rule.id); await internal.runNext();
    assert.equal((await manager.readRuns(rule.id))[0].status, 'skipped'); assert.equal(await count(notes), before + 1);
  });
  await t.test('nested flows preserve typed array iteration and reject recursive calls', async () => {
    const child = await create(definition([node('value', 'transform', { value: '{{ $trigger.value }}' })], { trigger: 'operation' }));
    const parent = await create(definition([node('call', 'trigger', { flow: child.id, payload: [{ value: 1 }, { value: 2 }] })]));
    assert.deepEqual((await manager.runManual(parent.id, {})).output, [1, 2]);
    const recursive = await manager.save({ ...child, operations: [node('self', 'trigger', { flow: child.id, payload: {} })], entry: 'self' }, child.id);
    await assert.rejects(manager.runManual(parent.id, {}), { code: 'FLOW_RECURSION_LIMIT' });
    assert.equal(recursive.revision, 2);
  });
  await t.test('webhooks are private by default, explicitly public transforms work and log secrets are redacted', async () => {
    let rule = await create(definition([node('output', 'transform', { value: '{{ $trigger.body }}' })], { trigger: 'webhook', options: { method: 'POST', response: '$last' } }));
    assert.equal((await request(`/flows/trigger/${rule.id}`, null, 'POST', {})).status, 403);
    assert.equal((await request(`/flows/trigger/${rule.id}`, adminToken)).status, 404);
    rule = await manager.save({ ...rule, options: { ...rule.options, public: true } }, rule.id);
    const result = await request(`/flows/trigger/${rule.id}`, null, 'POST', { message: 'Public', access_token: 'synthetic-secret' });
    assert.equal(result.status, 200); assert.equal(result.body.data.output.message, 'Public');
    const history = await manager.readRuns(rule.id); assert.equal(history[0].output.access_token, '[REDACTED]'); assert.equal(history[0].trigger_data.body.access_token, '[REDACTED]');
    assert.equal((await request(`/flows/${rule.id}/runs`, null)).status, 403);
  });
  await t.test('replicas deduplicate UTC schedules with physical unique constraints', async () => {
    const rule = await create(definition([node('value', 'transform', { value: '{{ $trigger.scheduled_at }}' })], { trigger: 'schedule', accountability: 'public', options: { cron: '30 15 12 * * *', response: '$last' } }));
    const other = new FlowRuntime(shared), now = new Date('2026-10-15T12:15:30Z');
    await Promise.all([runtime.tick(now), other.tick(now)]);
    const history = await manager.readRuns(rule.id); assert.equal(history.length, 1); assert.equal(history[0].status, 'succeeded'); assert.equal(history[0].output, now.toISOString());
  });
  await t.test('event ancestry survives queued handoffs and prevents asynchronous A to B to A loops', async () => {
    const a = await create(definition([node('note', 'create', { collection: notes, payload: { title: 'A to B' }, emit_events: true })], { trigger: 'event', accountability: 'system', options: { mode: 'action', events: ['items.create'], collections: [articles] } }));
    const b = await create(definition([node('article', 'create', { collection: articles, payload: { title: 'B to A' }, emit_events: true })], { trigger: 'event', accountability: 'system', options: { mode: 'action', events: ['items.create'], collections: [notes] } }));
    assert.equal((await request(`/items/${articles}`, staffToken, 'POST', { title: 'Start lineage' })).status, 201);
    assert.equal(await internal.runNext(), true); assert.equal(await internal.runNext(), true); assert.equal(await internal.runNext(), false);
    assert.equal((await manager.readRuns(a.id)).length, 1); assert.equal((await manager.readRuns(b.id)).length, 1);
  });
});
