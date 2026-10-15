import { flowListPredicate, normalizeFlowPageQuery } from '../src/flows/query.js';
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
import { SCRIPT_DEFAULTS } from '../src/flows/script.js';

const node = (id, type, options = {}, extra = {}) => ({ id, key: id, name: id, type, options, position: { x: 100, y: 100 }, resolve: null, reject: null, ...extra });
const flow = operations => ({ id: 'test-flow', name: 'Example', status: 'active', trigger: 'manual', options: {}, entry: operations[0]?.id ?? null, operations });
const context = (extra = {}) => ({ accountability: createAccountability({ user: 'actor', role: 'staff' }), trigger: { amount: 4 }, schema: { collections: {} }, ...extra });

test('every downloadable documentation example validates inactive, and the documented pure examples execute unchanged', async () => {
  const root = new URL('../../../docs/examples/flows/', import.meta.url);
  const examples = new Map(readdirSync(root).filter(name => name.endsWith('.json')).map(name => [name, JSON.parse(readFileSync(new URL(name, root), 'utf8'))]));
  assert.equal(examples.size, 11);
  for (const [name, value] of examples) { const normalized = normalizeFlow(value); assert.equal(normalized.status, 'inactive', name); assert.ok(normalized.entry, name); }
  const greeting = await executeFlowGraph({ ...examples.get('manual-greeting.json'), id: 'docs-greeting' }, context({ trigger: { body: { name: 'YunCMS' } } }));
  assert.deepEqual(greeting.output, { message: 'Hello YunCMS' });
  for (const approved of [false, true]) {
    const result = await executeFlowGraph({ ...examples.get('approval-branches.json'), id: 'docs-approval' }, context({ trigger: { body: { approved } } }));
    assert.deepEqual(result.output, { decision: approved ? 'approved' : 'needs_review', accepted: approved });
    assert.deepEqual(result.trace.map(step => step.key), ['approval', approved ? 'accepted' : 'rejected', 'result']);
  }
  const order = await executeFlowGraph({ ...examples.get('script-order-total.json'), id: 'docs-order' }, context({ scripts: { enabled: true }, trigger: { body: { lines: [{ quantity: 2, unit_price_cents: 1490 }, { quantity: 1, unit_price_cents: 500 }] } } }));
  assert.equal(order.output.total_cents, 3480); assert.match(order.output.fingerprint, /^[a-f0-9]{64}$/);
  const commonjs = await executeFlowGraph({ ...examples.get('script-commonjs.json'), id: 'docs-commonjs' }, context({ scripts: { enabled: true }, trigger: { body: { value: 21 } } }));
  assert.equal(commonjs.output.query, 'SELECT 21 AS value');
});

test('flow defaults are inactive, explicitly inherit the trigger and reject unsafe graphs', () => {
  const draft = normalizeFlow({ name: 'Draft', operations: [] });
  assert.equal(draft.status, 'inactive'); assert.equal(draft.accountability, 'trigger'); assert.equal(draft.entry, null);
  for (const input of [
    { ...draft, status: 'active' },
    flow([node('one', 'transform', {}, { resolve: 'missing' })]),
    flow([node('one', 'transform', {}, { resolve: 'two' }), node('two', 'log', {}, { reject: 'one' })]),
    flow([node('one', 'transform'), node('one', 'log')]),
    flow([node('one', 'unknown_operation')]),
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

test('logs redact sensitive keys, sleep observes cancellation and recursion is bounded', async () => {
  assert.deepEqual(safeFlowValue({ password: 'private', nested: { access_token: 'private' } }), { password: '[REDACTED]', nested: { access_token: '[REDACTED]' } });
  await assert.rejects(executeFlowGraph(flow([node('wait', 'sleep', { milliseconds: 1000 })]), context({ signal: AbortSignal.timeout(1) })), { code: 'FLOW_TIMEOUT', status: 504 });
  await assert.rejects(flowExecutionStorage.run({ stack: ['test-flow'] }, () => executeFlowGraph(flow([node('one', 'log')]), context())), { code: 'FLOW_RECURSION_LIMIT' });
});

test('flow migration, cron contracts and safe configuration defaults remain explicit', () => {
  const migration = CORE_MIGRATIONS.find(entry => entry.id === '0023-flows');
  assert.equal(migration.id, '0023-flows'); assert.ok(REQUIRED_CORE_MIGRATION_IDS.includes(migration.id)); assert.equal(migration.statements.length, 2);
  const sql = migration.statements.join('\n');
  assert.match(sql, /DEFAULT 'inactive'/); assert.match(sql, /UNIQUE KEY uq_flow_schedule/); assert.match(sql, /REFERENCES yuncms_flows \(id\) ON DELETE CASCADE/);
  const utc = new Date('2026-10-15T12:15:30Z');
  assert.equal(flowCronMatchesUtc(parseFlowCronExpression('30 */5 * * * *'), utc), true);
  assert.equal(flowCronMatchesUtc(parseFlowCronExpression('*/5 * * * *'), utc), false);
  assert.equal(flowCronMatchesUtc(parseFlowCronExpression('*/5 * * * *'), new Date('2026-10-15T12:15:00Z')), true);
  assert.throws(() => parseFlowCronExpression('* * *'));
  assert.deepEqual(loadConfig({}).flows, { admissionRequired: false, requestHosts: [], envAllowList: [], scripts: SCRIPT_DEFAULTS });
  assert.deepEqual(loadConfig({ FLOWS_REQUEST_ALLOWED_HOSTS: ' api.example.test, API.OTHER.TEST ', FLOWS_ENV_ALLOW_LIST: 'PUBLIC_URL, STAGE' }).flows, { admissionRequired: false, requestHosts: ['api.example.test', 'api.other.test'], envAllowList: ['PUBLIC_URL', 'STAGE'], scripts: SCRIPT_DEFAULTS });
  assert.equal(loadConfig({ FLOWS_ADMISSION_REQUIRED: 'true' }).flows.admissionRequired, true);
  assert.deepEqual(loadConfig({ FLOWS_SCRIPTS_ENABLED: 'true', FLOWS_SCRIPT_TIMEOUT_MS: '100', FLOWS_SCRIPT_MEMORY_MB: '32', FLOWS_SCRIPT_CONCURRENCY: '1' }).flows.scripts, { enabled: true, timeoutMs: 100, memoryMb: 32, concurrency: 1 });
  for (const [key, invalid] of [['FLOWS_SCRIPT_TIMEOUT_MS', ['99', '30001', 'NaN']], ['FLOWS_SCRIPT_MEMORY_MB', ['31', '513', '32.5']], ['FLOWS_SCRIPT_CONCURRENCY', ['0', '9', '-1']]]) {
    for (const value of invalid) assert.throws(() => loadConfig({ [key]: value }), new RegExp(key));
  }
  assert.throws(() => loadConfig({ FLOWS_SCRIPTS_ENABLED: 'perhaps' }), /Expected boolean/);
});

test('flow catalogue and history pagination use bounded defaults and numeric SQL values', () => {
  assert.deepEqual(normalizeFlowPageQuery(), { limit: 10, offset: 0, summary: false, search: '', status: null, trigger: null });
  assert.deepEqual(normalizeFlowPageQuery({}, { runs: true }), { limit: 10, offset: 0, summary: false });
  assert.deepEqual(normalizeFlowPageQuery({ limit: '100', offset: '1000', summary: '1', meta: 'filter_count', search: '  Türkçe  ', status: 'active', trigger: 'webhook' }), { limit: 100, offset: 1000, summary: true, search: 'Türkçe', status: 'active', trigger: 'webhook' });
});

test('flow pagination rejects overflow, SQL fragments, arrays and unbounded queries', () => {
  for (const input of [null, [], { limit: 0 }, { limit: 101 }, { limit: -1 }, { limit: '1e2' }, { limit: ['25'] }, { offset: 2147483648 }, { offset: '0; DROP TABLE yuncms_flows' }, { offset: {} }, { limit: Infinity }, { summary: 'yes' }, { status: 'unknown' }, { trigger: 'sql' }, { search: ['text'] }, { search: 'x'.repeat(201) }, { meta: 'unknown' }, { 'search[]': 'text' }]) {
    assert.throws(() => normalizeFlowPageQuery(input), { code: 'INVALID_FLOW_QUERY' });
  }
});

test('flow search and filters remain literal parameter values in a trusted SQL predicate', () => {
  const value = "%_' OR 1=1 --", where = flowListPredicate(normalizeFlowPageQuery({ search: value, status: 'inactive', trigger: 'manual' }));
  assert.equal(where.sql, ' WHERE LOCATE(?, name) > 0 AND status = ? AND trigger_type = ?');
  assert.deepEqual(where.values, [value, 'inactive', 'manual']); assert.equal(where.sql.includes(value), false);
});

test('native Flow read delegation is registered as a filtered read-only system resource', () => {
  const migration = readFileSync(new URL('../src/migrations/0024-flow-read-permissions.js', import.meta.url), 'utf8');
  assert.ok(REQUIRED_CORE_MIGRATION_IDS.includes('0024-flow-read-permissions'));
  assert.match(migration, /filter-read/); assert.match(migration, /JSON_ARRAY\('read'\)/);
  for (const field of ['id', 'status', 'trigger_type', 'user_created']) assert.ok(migration.includes(`'${field}'`));
});
