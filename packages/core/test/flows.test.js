import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync, readdirSync } from 'node:fs';
import { createAccountability, createPublicAccountability, createSystemAccountability } from '../src/accountability.js';
import { CORE_MIGRATIONS, REQUIRED_CORE_MIGRATION_IDS } from '../src/bootstrap.js';
import { loadConfig } from '../src/config.js';
import { flowPath, normalizeFlow, resolveFlowTemplates } from '../src/flows/definition.js';
import { executeFlowGraph, evaluateFlowCondition, safeFlowValue } from '../src/flows/engine.js';
import { parseFlowCronExpression, flowCronMatchesUtc } from '../src/flows/cron.js';
import { flowExecutionStorage } from '../src/flows/context.js';
import { FlowsService } from '../src/services/flows-service.js';

const node = (id, type, options = {}, extra = {}) => ({ id, key: id, name: id, type, options, position: { x: 100, y: 100 }, resolve: null, reject: null, ...extra });
const flow = operations => ({ id: 'test-flow', name: 'Example', status: 'active', trigger: 'manual', options: {}, entry: operations[0]?.id ?? null, operations });
const context = (extra = {}) => ({ accountability: createAccountability({ user: 'actor', role: 'staff' }), trigger: { amount: 4 }, schema: { collections: {} }, ...extra });

test('every downloadable documentation example validates inactive, and the documented pure examples execute unchanged', async () => {
  const root = new URL('../../../docs/examples/flows/', import.meta.url);
  const examples = new Map(readdirSync(root).filter(name => name.endsWith('.json')).map(name => [name, JSON.parse(readFileSync(new URL(name, root), 'utf8'))]));
  assert.equal(examples.size, 8);
  for (const [name, value] of examples) { const normalized = normalizeFlow(value); assert.equal(normalized.status, 'inactive', name); assert.ok(normalized.entry, name); }
  const greeting = await executeFlowGraph({ ...examples.get('manual-greeting.json'), id: 'docs-greeting' }, context({ trigger: { body: { name: 'YunCMS' } } }));
  assert.deepEqual(greeting.output, { message: 'Hello YunCMS' });
  for (const approved of [false, true]) {
    const result = await executeFlowGraph({ ...examples.get('approval-branches.json'), id: 'docs-approval' }, context({ trigger: { body: { approved } } }));
    assert.deepEqual(result.output, { decision: approved ? 'approved' : 'needs_review', accepted: approved });
    assert.deepEqual(result.trace.map(step => step.key), ['approval', approved ? 'accepted' : 'rejected', 'result']);
  }
});

test('flow defaults are inactive, explicitly inherit the trigger and reject unsafe graphs', () => {
  const draft = normalizeFlow({ name: 'Draft', operations: [] });
  assert.equal(draft.status, 'inactive'); assert.equal(draft.accountability, 'trigger'); assert.equal(draft.entry, null);
  for (const input of [
    { ...draft, status: 'active' },
    flow([node('one', 'transform', {}, { resolve: 'missing' })]),
    flow([node('one', 'transform', {}, { resolve: 'two' }), node('two', 'log', {}, { reject: 'one' })]),
    flow([node('one', 'transform'), node('one', 'log')]),
    flow([node('one', 'script')]),
    flow([null]),
    { ...flow([node('one', 'log')]), operations: Array.from({ length: 101 }, (_, i) => node(`n${i}`, 'log')) },
    JSON.parse('{"name":"Unsafe","operations":[],"__proto__":{"admin":true}}'),
  ]) assert.throws(() => normalizeFlow(input), { code: 'INVALID_FLOW' });
  assert.throws(() => normalizeFlow({ ...flow([node('one', 'log')]), options: { response: '$last.constructor' } }), { code: 'INVALID_FLOW_VARIABLE' });
});

test('typed data-chain variables support arrays, preserve null and reject prototype traversal', () => {
  const data = { $trigger: { enabled: false, rows: [{ id: 4 }], empty: null } };
  assert.deepEqual(resolveFlowTemplates({ id: '{{ $trigger.rows[0].id }}', text: 'Record {{ $trigger.rows.0.id }}', flag: '{{$trigger.enabled}}', empty: '{{$trigger.empty}}' }, data), { id: 4, text: 'Record 4', flag: false, empty: null });
  assert.throws(() => flowPath(data, '$trigger.constructor.name'), { code: 'INVALID_FLOW_VARIABLE' });
  assert.throws(() => resolveFlowTemplates('{{$trigger.missing}}', data), { code: 'FLOW_VARIABLE_NOT_FOUND' });
  assert.equal(flowPath({}, 'toString'), undefined);
});

test('conditions select only one branch and resolved branches can merge into a common operation', async () => {
  const definition = flow([
    node('check', 'condition', { rules: { '$trigger.amount': { _gte: 5 } } }, { resolve: 'yes', reject: 'no' }),
    node('yes', 'transform', { value: { accepted: true } }, { resolve: 'finish' }),
    node('no', 'transform', { value: { accepted: false } }, { resolve: 'finish' }),
    node('finish', 'transform', { value: { verdict: '{{$last.accepted}}' } }),
  ]);
  for (const amount of [4, 5]) {
    const result = await executeFlowGraph(definition, context({ trigger: { amount } }));
    assert.deepEqual(result.output, { verdict: amount >= 5 });
    assert.deepEqual(result.trace.map(step => step.key), ['check', amount >= 5 ? 'yes' : 'no', 'finish']);
  }
  assert.equal(evaluateFlowCondition({}, { missing: { _null: true } }), false);
  assert.throws(() => evaluateFlowCondition({ x: 1 }, { x: { _sql: 'DROP TABLE' } }), { code: 'INVALID_FLOW_OPERATION' });
});

test('unhandled rejection carries a bounded trace and stops later operations', async () => {
  await assert.rejects(executeFlowGraph(flow([node('reject', 'error', { code: 'BUSINESS_DENIED', status: 403, message: 'Denied' }, { resolve: 'later' }), node('later', 'transform', { value: 'must not run' })]), context()), error => {
    assert.equal(error.code, 'BUSINESS_DENIED'); assert.equal(error.status, 403); assert.equal(error.flowTrace.length, 1); return true;
  });
});

test('CRUD operations keep verified native authority and hooks while suppressing only flow events by default', async () => {
  const seen = [], emitter = {};
  class ItemsService {
    constructor(collection, options) { seen.push({ collection, options }); }
    async createMany(rows) { assert.equal(flowExecutionStorage.getStore().suppressFlowEvents, true); return rows.map(row => ({ ...row, id: 'new', created_at: new Date('2026-10-15T00:00:00Z') })); }
  }
  const result = await executeFlowGraph(flow([node('create', 'create', { collection: 'articles', payload: { title: 'Example' } })]), context({ emitter, services: { ItemsService }, database: {}, schema: { collections: { articles: { system: false } } } }));
  assert.equal(seen[0].options.accountability.admin, false); assert.equal(seen[0].options.accountability.user, 'actor'); assert.equal(seen[0].options.emitter, emitter);
  assert.equal(result.output[0].created_at, '2026-10-15T00:00:00.000Z');
});

test('requests require explicit server hostname allow-list and never follow redirects', async () => {
  const definition = flow([node('request', 'request', { url: 'http://localhost/private' })]);
  let requests = 0;
  await assert.rejects(executeFlowGraph(definition, context({ fetch: () => { requests++; } })), { code: 'FLOW_REQUEST_FORBIDDEN' });
  assert.equal(requests, 0);
  const result = await executeFlowGraph(definition, context({ requestHosts: ['localhost'], fetch: async (_url, options) => { requests++; assert.equal(options.redirect, 'manual'); return new Response('{"ok":true}', { headers: { 'content-type': 'application/json' } }); } }));
  assert.deepEqual(result.output.body, { ok: true });
  await assert.rejects(executeFlowGraph(definition, context({ requestHosts: ['localhost'], fetch: async () => new Response(null, { status: 302, headers: { location: 'http://other-host/' } }) })), { code: 'FLOW_REQUEST_REDIRECT' });
});

test('read, update and delete use bounded ids and the same native ItemsService authority', async () => {
  const calls = [];
  class ItemsService {
    constructor(collection, options) { assert.equal(collection, 'articles'); assert.equal(options.accountability.role, 'staff'); }
    async readOne(id, query) { calls.push(['read', id, query]); return { id }; }
    async readMany(query) { calls.push(['many', query]); return []; }
    async updateOne(id, payload) { calls.push(['update', id, payload]); return { id, ...payload }; }
    async deleteOne(id) { calls.push(['delete', id]); return true; }
  }
  const options = context({ services: { ItemsService }, schema: { collections: { articles: {} } } });
  const result = await executeFlowGraph(flow([
    node('read', 'read', { collection: 'articles', ids: ['one', 'two'], query: { fields: ['id'] } }, { resolve: 'update' }),
    node('update', 'update', { collection: 'articles', ids: '{{read.0.id}}', payload: { title: 'Edited' } }, { resolve: 'delete' }),
    node('delete', 'delete', { collection: 'articles', ids: ['two'] }),
  ]), options);
  assert.deepEqual(result.output, [true]); assert.deepEqual(calls.map(call => call[0]), ['read', 'read', 'update', 'delete']);
  await executeFlowGraph(flow([node('read', 'read', { collection: 'articles', query: { limit: 999 } })]), options);
  assert.equal(calls.at(-1)[1].limit, 100);
  for (const ids of [[], Array.from({ length: 101 }, (_, i) => i), [{}]]) await assert.rejects(executeFlowGraph(flow([node('del', 'delete', { collection: 'articles', ids })]), options), { code: 'INVALID_FLOW_OPERATION' });
  await assert.rejects(executeFlowGraph(flow([node('read', 'read', { collection: 'yuncms_users' })]), options), { code: 'INVALID_FLOW_OPERATION' });
});

test('email uses the configured native mailer, enforces recipient bounds and never requires an external test message', async () => {
  const sent = [];
  const definition = flow([node('mail', 'mail', { to: ['one@example.test', 'two@example.test'], subject: 'Hello', text: 'Amount {{$trigger.amount}}' })]);
  await assert.rejects(executeFlowGraph(definition, context()), { code: 'MAIL_NOT_CONFIGURED' });
  await executeFlowGraph(definition, context({ mailer: { async send(message, options) { assert.equal(options.accountability.user, 'actor'); sent.push(message); } } }));
  assert.deepEqual(sent.map(message => message.to), ['one@example.test', 'two@example.test']); assert.equal(sent[0].text, 'Amount 4');
  await assert.rejects(executeFlowGraph(flow([node('mail', 'mail', { to: Array(21).fill('one@example.test') })]), context({ mailer: { send() { assert.fail('Invalid recipients reached SMTP'); } } })), { code: 'INVALID_FLOW_OPERATION' });
});

test('a deadline crossed during the final operation cannot be reported as successful', async () => {
  const controller = new AbortController();
  const operations = new Map([['slow', async () => { controller.abort(); return 'late'; }]]);
  await assert.rejects(executeFlowGraph(flow([node('slow', 'slow')]), context({ operations, signal: controller.signal })), error => {
    assert.equal(error.code, 'FLOW_TIMEOUT'); assert.equal(error.flowTrace[0].status, 'failed'); return true;
  });
});

test('logs redact sensitive keys, sleep observes cancellation and recursion is bounded', async () => {
  assert.deepEqual(safeFlowValue({ password: 'private', nested: { access_token: 'private' } }), { password: '[REDACTED]', nested: { access_token: '[REDACTED]' } });
  await assert.rejects(executeFlowGraph(flow([node('wait', 'sleep', { milliseconds: 1000 })]), context({ signal: AbortSignal.timeout(1) })), { code: 'FLOW_TIMEOUT', status: 504 });
  await assert.rejects(flowExecutionStorage.run({ stack: ['test-flow'] }, () => executeFlowGraph(flow([node('one', 'log')]), context())), { code: 'FLOW_RECURSION_LIMIT' });
});

test('flow management and internal dispatch reject denied authority before database access', async () => {
  for (const accountability of [createPublicAccountability(), createAccountability({ user: 'staff', role: 'staff' })]) {
    const database = { query() { assert.fail('Denied caller reached SQL'); } };
    const service = new FlowsService({ database, accountability });
    for (const call of [() => service.readMany(), () => service.save({}), () => service.deleteOne('flow', 1), () => service.runTriggered('flow', {}, createSystemAccountability()), () => service.readRuns('flow'), () => service.configuration()]) await assert.rejects(call(), { code: 'FORBIDDEN' });
  }
});

test('flow migration, cron contracts and safe configuration defaults remain explicit', () => {
  const migration = CORE_MIGRATIONS.at(-1);
  assert.equal(migration.id, '0023-flows'); assert.ok(REQUIRED_CORE_MIGRATION_IDS.includes(migration.id)); assert.equal(migration.statements.length, 2);
  const sql = migration.statements.join('\n');
  assert.match(sql, /DEFAULT 'inactive'/); assert.match(sql, /UNIQUE KEY uq_flow_schedule/); assert.match(sql, /REFERENCES yuncms_flows \(id\) ON DELETE CASCADE/);
  const utc = new Date('2026-10-15T12:15:30Z');
  assert.equal(flowCronMatchesUtc(parseFlowCronExpression('30 */5 * * * *'), utc), true);
  assert.equal(flowCronMatchesUtc(parseFlowCronExpression('*/5 * * * *'), utc), false);
  assert.equal(flowCronMatchesUtc(parseFlowCronExpression('*/5 * * * *'), new Date('2026-10-15T12:15:00Z')), true);
  assert.throws(() => parseFlowCronExpression('* * *'));
  assert.deepEqual(loadConfig({}).flows, { requestHosts: [], envAllowList: [] });
  assert.deepEqual(loadConfig({ FLOWS_REQUEST_ALLOWED_HOSTS: ' api.example.test, API.OTHER.TEST ', FLOWS_ENV_ALLOW_LIST: 'PUBLIC_URL, STAGE' }).flows, { requestHosts: ['api.example.test', 'api.other.test'], envAllowList: ['PUBLIC_URL', 'STAGE'] });
});
