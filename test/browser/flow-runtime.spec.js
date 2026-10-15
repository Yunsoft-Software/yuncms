import { randomUUID } from 'node:crypto';
import { test, expect } from '@playwright/test';

const collection = 'browser_flow_records';
let headers, config, network, prefix, flowIds;
const node = (id, type, options, resolve = null, reject = null) => ({ id, key: id, name: id, type, options, position: { x: 380, y: 100 }, resolve, reject });
async function login(request, email = 'flows-admin@example.test') {
  const response = await request.post('/auth/login', { data: { email, password: 'Browser-flow-fixture-123!' } }); expect(response.status()).toBe(200); return (await response.json()).data;
}
async function create(request, operations, extra = {}) {
  const response = await request.post('/flows', { headers, data: { name: prefix, status: 'active', trigger: 'manual', accountability: 'trigger', options: { response: '$last' }, entry: operations[0].id,
    operations: operations.map((operation, i) => ({ ...operation, position: { x: 380 + i * 330, y: 100 } })), ...extra } });
  expect(response.status()).toBe(201); const flow = (await response.json()).data; flowIds.push(flow.id); return flow;
}
async function open(page, flow) { await page.goto(`/?flow_case=${flow.id}#/flows/${flow.id}`); await expect(page.getByTestId('flow-canvas')).toBeVisible(); }
async function run(page, flow, payload = {}) {
  await page.getByRole('button', { name: 'Run saved flow', exact: true }).click();
  await page.getByRole('dialog').getByLabel('Trigger payload (JSON)', { exact: true }).fill(JSON.stringify(payload));
  const response = page.waitForResponse(result => result.url().endsWith(`/flows/${flow.id}/run`) && result.request().method() === 'POST', { timeout: 40000 });
  await page.getByRole('dialog').getByRole('button', { name: 'Run saved flow', exact: true }).click(); return response;
}
async function runs(request, flow) { const response = await request.get(`/flows/${flow.id}/runs`, { headers }); expect(response.status()).toBe(200); return (await response.json()).data; }
async function records(request) {
  const query = encodeURIComponent(JSON.stringify({ title: { _starts_with: prefix } }));
  return (await (await request.get(`/items/${collection}?filter=${query}`, { headers })).json()).data;
}
async function pause(request, flow) {
  const current = (await (await request.get(`/flows/${flow.id}`, { headers })).json()).data;
  expect((await request.put(`/flows/${flow.id}`, { headers, data: { ...current, status: 'inactive' } })).status()).toBe(200);
}

test.beforeEach(async ({ page, request }) => {
  prefix = 'FA-' + randomUUID().slice(0, 8); flowIds = [];
  const session = await login(request); headers = { authorization: `Bearer ${session.access_token}` };
  config = (await (await request.get('/flows/configuration', { headers })).json()).data;
  network = (await (await request.get('/extensions/flow-fixture', { headers })).json()).data;
  await page.addInitScript(value => { sessionStorage.setItem('yuncms.studio.session', JSON.stringify(value)); localStorage.setItem('yuncms.studio.locale', 'en'); }, session);
});
test.afterEach(async ({ request }) => {
  for (const id of flowIds) {
    const response = await request.get(`/flows/${id}`, { headers });
    if (response.ok()) { const flow = (await response.json()).data; await request.delete(`/flows/${id}?revision=${flow.revision}`, { headers }); }
  }
  for (const record of await records(request)) await request.delete(`/items/${collection}/${record.id}`, { headers });
});

test('Studio creates a Run script node, imports native and npm modules, persists raw code and writes through real native RPC', async ({ page, request }) => {
  await page.goto('/#/flows/new');
  await page.locator('.flow-inspector').getByLabel('Name', { exact: true }).fill(prefix);
  await page.getByLabel('Operations', { exact: true }).selectOption('script'); await page.getByRole('button', { name: 'Add operation', exact: true }).click();
  const id = await page.locator('.react-flow__node:not([data-id="trigger"])').getAttribute('data-id');
  const code = `import { createHash } from 'node:crypto'; import mysql from 'mysql2/promise';
export default async (data, context) => {
  const row = await context.items('${collection}').createOne({ title: data.$trigger.body.title, status: 'draft' });
  return { id: row.id, value: data.$trigger.body.value * 2, driver: typeof mysql.createPool,
    digest: createHash('sha256').update('abc').digest('hex'), literal: '{{ untouched }}', env: data.$env.TEST_PUBLIC_VALUE };
}`;
  await page.getByLabel('JavaScript code', { exact: true }).fill(code);
  const a = await page.locator('.react-flow__node[data-id="trigger"] .react-flow__handle[data-handleid="resolve"]').boundingBox();
  const b = await page.locator(`.react-flow__node[data-id="${id}"] .react-flow__handle[data-handleid="input"]`).boundingBox();
  await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2); await page.mouse.down(); await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 15 }); await page.mouse.up();
  await page.locator('.react-flow__node[data-id="trigger"]').click(); await page.getByLabel('Status', { exact: true }).selectOption('active');
  const saving = page.waitForResponse(response => response.url().endsWith('/flows') && response.request().method() === 'POST');
  await page.getByRole('button', { name: 'Save', exact: true }).click(); const flow = (await (await saving).json()).data; flowIds.push(flow.id);
  await page.reload(); await expect(page.locator('.react-flow__edge')).toHaveCount(1);
  await page.locator(`.react-flow__node[data-id="${id}"]`).click(); await expect(page.getByLabel('JavaScript code', { exact: true })).toHaveValue(code);
  const result = await run(page, flow, { body: { title: prefix + " ' OR 1=1 --", value: 7 } }); expect(result.status()).toBe(200);
  const output = (await result.json()).data.output; expect(output.value).toBe(14); expect(output.driver).toBe('function'); expect(output.literal).toBe('{{ untouched }}'); expect(output.env).toBe('visible');
  expect(output.digest).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  expect((await records(request))[0].id).toBe(output.id); await expect(page.getByTestId('flow-run-output')).toContainText(output.id);
  await page.screenshot({ path: `.yuncms/flows-tests/${test.info().project.name}/flow-script-editor.png`, fullPage: true });
});

test('CommonJS require works in a saved script and typed input remains JSON', async ({ page, request }) => {
  const flow = await create(request, [node('script', 'script', { format: 'commonjs', code: "const mysql = require('mysql2'); module.exports = data => ({ query: mysql.format('SELECT ? AS value', [data.$trigger.body.value]), input: data.$trigger.body });" })]);
  await open(page, flow); await page.locator('.react-flow__node[data-id="script"]').click(); await expect(page.getByLabel('Script format')).toHaveValue('commonjs');
  const response = await run(page, flow, { body: { value: 21, enabled: false, empty: null } }); expect(response.status()).toBe(200);
  expect((await response.json()).data.output).toEqual({ query: 'SELECT 21 AS value', input: { value: 21, enabled: false, empty: null } });
});

test('script native proxies execute every supported CRUD method, redact real logs and enforce call/batch bounds', async ({ page, request }) => {
  const flow = await create(request, [node('script', 'script', { code: `export default async (data, context) => {
    const items = context.items('${collection}');
    const created = await items.createMany([{ title: data.$trigger.title + '-A' }, { title: data.$trigger.title + '-B' }]);
    const first = await items.readOne(created[0].id); await items.updateOne(first.id, { status: 'review' });
    const found = await items.readMany({ filter: { title: { _starts_with: data.$trigger.title } } });
    context.log({ proof: data.$trigger.title, password: 'script-private-value', env: context.env.TEST_PUBLIC_VALUE });
    console.info({ proof: data.$trigger.title, access_token: 'script-private-token' });
    await items.deleteOne(created[0].id); await items.deleteOne(created[1].id);
    return { count: found.length, statuses: found.map(row => row.status), actor: context.accountability.user };
  }` })]);
  await open(page, flow); const result = await run(page, flow, { title: prefix }); expect(result.status()).toBe(200);
  const output = (await result.json()).data.output; expect(output.count).toBe(2); expect(output.statuses).toContain('review'); expect(output.actor).toBeTruthy(); expect(await records(request)).toHaveLength(0);
  const logs = (await (await request.get('/extensions/flow-fixture/logs', { headers })).json()).data.filter(record => JSON.stringify(record).includes(prefix));
  expect(JSON.stringify(logs)).toContain('[REDACTED]'); expect(JSON.stringify(logs)).toContain('visible'); expect(JSON.stringify(logs)).not.toContain('script-private-value'); expect(JSON.stringify(logs)).not.toContain('script-private-token');
  for (const [code, expected] of [
    [`export default async (_data, context) => { for (let i = 0; i < 101; i++) await context.items('${collection}').readMany({ limit: 1 }); }`, 'FLOW_SCRIPT_CALL_LIMIT'],
    [`export default async (_data, context) => context.items('${collection}').createMany(Array.from({ length: 101 }, () => ({ title: 'Too many' })))`, 'INVALID_FLOW_OPERATION'],
  ]) {
    const bounded = await create(request, [node('script', 'script', { code })]);
    const failed = await request.post(`/flows/${bounded.id}/run`, { headers, data: {} }); expect(failed.status()).toBe(400); expect((await failed.json()).errors[0].code).toBe(expected);
  }
});

test('script data calls retain selected-user authority despite forged input and report native denials in history', async ({ page, request }) => {
  const staff = config.users.find(user => user.email === 'flows-staff@example.test');
  const flow = await create(request, [node('script', 'script', { code: `export default async (_, context) => context.items('${collection}').createOne({title:'${prefix}',status:'draft'});` })], { accountability: 'user', run_as: staff.id });
  await open(page, flow); const response = await run(page, flow, { accountability: { user: 'admin', admin: true }, system: true });
  expect(response.status()).toBe(403); expect(await records(request)).toHaveLength(0);
  await expect(page.locator('.flow-history')).toContainText('FORBIDDEN'); expect((await runs(request, flow))[0].status).toBe('failed');
});

for (const [title, code, expected] of [
  ['invalid syntax', 'export default function (', 'FLOW_SCRIPT_ERROR'],
  ['null exception', 'export default () => { throw null; }', 'FLOW_SCRIPT_ERROR'],
  ['primitive exception', "export default () => { throw 'script primitive'; }", 'FLOW_SCRIPT_ERROR'],
  ['missing npm package', "import x from 'missing-flow-package-fixture'; export default () => x", 'ERR_MODULE_NOT_FOUND'],
  ['oversized output', "export default () => 'x'.repeat(262145)", 'FLOW_OUTPUT_LIMIT'],
]) test(`script ${title} fails with a real process and a visible node trace`, async ({ page, request }) => {
  const flow = await create(request, [node('script', 'script', { code })]); await open(page, flow);
  expect((await run(page, flow)).status()).toBe(400); await expect(page.locator('.flow-history')).toContainText(expected); await expect(page.locator('.flow-node-failed')).toHaveCount(1);
});

test('script failure follows a reject connection and the recovery node completes the run', async ({ page, request }) => {
  const flow = await create(request, [node('script', 'script', { code: 'export default () => { throw new Error("Expected business failure"); }' }, null, 'recovery'), node('recovery', 'transform', { value: { recovered: true, code: '{{ $last.code }}' } })]);
  await open(page, flow); const response = await run(page, flow); expect(response.status()).toBe(200); expect((await response.json()).data.output).toEqual({ recovered: true, code: 'FLOW_SCRIPT_ERROR' });
  await expect(page.locator('.flow-node-failed')).toHaveCount(1); await expect(page.locator('.flow-node-succeeded')).toHaveCount(1);
});

test('a CPU loop is killed at the script deadline while the API and later executions remain operational', async ({ page, request }) => {
  const flow = await create(request, [node('script', 'script', { code: 'export default () => { while (true) {} }' })]); await open(page, flow);
  expect((await run(page, flow)).status()).toBe(504); await expect(page.locator('.flow-history')).toContainText('FLOW_SCRIPT_TIMEOUT');
  expect((await request.get('/health')).status()).toBe(200);
  const healthy = await create(request, [node('healthy', 'script', { code: 'export default () => ({healthy:true})' })]); await open(page, healthy); expect((await run(page, healthy)).status()).toBe(200);
});

test('a script exiting with native calls outstanding cannot crash the API or retain an execution slot', async ({ page, request }) => {
  const flow = await create(request, [node('script', 'script', { code: `export default async (data, context) => { const work = Array.from({ length: 16 }, () => context.items('${collection}').readMany({ limit: 1 })); setImmediate(() => process.exit(0)); await Promise.all(work); await new Promise(resolve => setTimeout(resolve, 500)); return true; };` })]);
  for (let attempt = 0; attempt < 3; attempt++) {
    const result = await request.post(`/flows/${flow.id}/run`, { headers, data: {} }); expect(result.status()).toBe(500);
    expect((await request.get('/health')).status()).toBe(200);
  }
  const healthy = await create(request, [node('script', 'script', { code: 'export default () => true' })]);
  await open(page, healthy); expect((await run(page, healthy)).status()).toBe(200); await expect(page.getByTestId('flow-run-output')).toContainText('true');
});

test('private webhook executes real HTTPS, computes with an npm script and persists the result in MySQL', async ({ page, request }) => {
  const flow = await create(request, [
    node('request', 'request', { url: network.httpsUrl + '/echo', method: 'POST', headers: { 'x-flow-proof': 'webhook-tls' }, body: '{{ $trigger.body }}' }, 'script'),
    node('script', 'script', { code: `import mysql from 'mysql2'; export default data => ({ title: '${prefix}-' + data.request.body.body.name, query: mysql.format('SELECT ?', [data.request.body.body.value]) });` }, 'created'),
    node('created', 'create', { collection, payload: { title: '{{ script.title }}', status: 'review' } }),
  ], { trigger: 'webhook', options: { method: 'POST', public: false, response: '$last' } });
  expect((await request.post(`/flows/trigger/${flow.id}`, { data: { name: 'Ada', value: 7 } })).status()).toBe(403);
  expect((await request.get(`/flows/trigger/${flow.id}`, { headers })).status()).toBe(404);
  const result = await request.post(`/flows/trigger/${flow.id}`, { headers, data: { name: 'Ada', value: 7 } }); expect(result.status()).toBe(200);
  expect((await records(request))[0].title).toBe(prefix + '-Ada');
  await open(page, flow); await page.locator('.flow-history-entry').first().click(); await expect(page.getByTestId('flow-run-output')).toContainText(prefix + '-Ada');
  const run = (await runs(request, flow))[0]; expect(run.trace.map(step => step.key)).toEqual(['request', 'script', 'created']); expect(run.trace[1].output.query).toBe('SELECT 7');
});

test('explicit public webhook inherits Public authority and exposes no environment outside the allowlist', async ({ page, request }) => {
  const flow = await create(request, [node('output', 'transform', { value: { actor: '{{ $accountability }}', env: '{{ $env }}', value: '{{ $trigger.body.value }}' } })], { trigger: 'webhook', options: { method: 'POST', public: true, response: '$last' } });
  const response = await request.post(`/flows/trigger/${flow.id}`, { data: { value: false, accountability: { admin: true } } }); expect(response.status()).toBe(200);
  const result = (await response.json()).data.output; expect(result.actor.admin).toBe(false); expect(result.actor.public).toBe(true); expect(result.env).toEqual({ TEST_PUBLIC_VALUE: 'visible' }); expect(result.value).toBe(false);
  await open(page, flow); await expect(page.getByLabel('Allow requests without authentication')).toBeChecked();
});

for (const [endpoint, expected, status] of [['redirect', 'FLOW_REQUEST_REDIRECT', 502], ['invalid-json', 'FLOW_REQUEST_INVALID_JSON', 502], ['too-large', 'FLOW_OUTPUT_LIMIT', 400], ['failure', 'FLOW_REQUEST_FAILED', 502], ['untrusted', 'FLOW_REQUEST_FAILED', 502], ['forbidden-host', 'FLOW_REQUEST_FORBIDDEN', 403]]) {
  test(`real HTTPS ${endpoint} rejects safely and shows its code in run history`, async ({ page, request }) => {
    const url = endpoint === 'untrusted' ? network.untrustedUrl : endpoint === 'forbidden-host' ? network.httpsUrl.replace('localhost', '127.0.0.1') : network.httpsUrl + '/' + endpoint;
    const flow = await create(request, [node('request', 'request', { url })]); await open(page, flow);
    expect((await run(page, flow)).status()).toBe(status); await expect(page.locator('.flow-history')).toContainText(expected);
    expect((await runs(request, flow))[0].error_code).toBe(expected);
  });
}

test('a real stalled HTTPS response reaches the graph deadline and leaves a failed persisted trace', async ({ page, request }) => {
  test.setTimeout(45000);
  const flow = await create(request, [node('request', 'request', { url: network.httpsUrl + '/slow' })]); await open(page, flow);
  expect((await run(page, flow)).status()).toBe(504); await expect(page.locator('.flow-history')).toContainText('FLOW_TIMEOUT');
  expect((await request.get('/health')).status()).toBe(200);
});

test('actual UTC cron polling calls HTTPS and writes a record under a selected normal user', async ({ page, request }) => {
  const actor = config.users.find(user => user.email === 'content-writer@example.test');
  const flow = await create(request, [node('request', 'request', { url: network.httpsUrl + '/echo', method: 'POST', body: { scheduled: '{{ $trigger.scheduled_at }}' } }, 'created'), node('created', 'create', { collection, payload: { title: prefix + '-cron', status: 'review' } })], { trigger: 'schedule', accountability: 'user', run_as: actor.id, options: { cron: '* * * * * *', response: '$last' } });
  await open(page, flow); await expect(page.getByRole('button', { name: 'Run saved flow', exact: true })).toBeDisabled();
  await expect.poll(async () => (await runs(request, flow)).some(run => run.status === 'succeeded'), { timeout: 12000 }).toBe(true);
  await pause(request, flow); expect((await records(request)).some(record => record.title === prefix + '-cron')).toBe(true);
  const history = await runs(request, flow), successful = history.find(run => run.status === 'succeeded');
  expect(successful.trace[0].output.body.body.scheduled).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  await page.reload(); await page.locator('.flow-history-entry').filter({ hasText: 'Succeeded' }).first().click(); await expect(page.getByTestId('flow-run-output')).toContainText(prefix + '-cron');
});

test('blocking script rollback removes both the original HTTP mutation and a native RPC side write', async ({ page, request }) => {
  const flow = await create(request, [node('script', 'script', { code: `export default async (_, context) => { await context.items('${collection}').createOne({title:'${prefix}-side',status:'draft'}); throw new Error('Reject original'); }` })], { trigger: 'event', options: { mode: 'filter', events: ['items.create'], collections: [collection] } });
  const result = await request.post(`/items/${collection}`, { headers, data: { title: prefix + '-original', status: 'draft' } }); expect(result.status()).toBe(400); expect(await records(request)).toHaveLength(0); expect(await runs(request, flow)).toHaveLength(0);
  await open(page, flow); await expect(page.locator('.flow-history')).toContainText('Run this flow');
});

test('after-commit event action runs from the durable worker and performs HTTPS plus a second native write', async ({ page, request }) => {
  const flow = await create(request, [node('request', 'request', { url: network.httpsUrl + '/echo', method: 'POST', body: { source: '{{ $trigger.payload.item.id }}' } }, 'child'), node('child', 'create', { collection, payload: { title: prefix + '-child', status: 'review' }, emit_events: false })], { trigger: 'event', options: { mode: 'action', events: ['items.create'], collections: [collection] } });
  const result = await request.post(`/items/${collection}`, { headers, data: { title: prefix + '-original', status: 'draft' } }); expect(result.status()).toBe(201); const id = (await result.json()).data.id;
  await expect.poll(async () => (await runs(request, flow)).some(run => run.status === 'succeeded'), { timeout: 12000 }).toBe(true);
  expect((await records(request)).map(row => row.title).sort()).toEqual([prefix + '-child', prefix + '-original']);
  expect((await runs(request, flow))[0].trace[0].output.body.body.source).toBe(id);
  await pause(request, flow); await open(page, flow); await page.locator('.flow-history-entry').first().click(); await expect(page.getByTestId('flow-run-output')).toContainText(prefix + '-child');
});

test('all native CRUD nodes, redacted logging and actual SMTP delivery execute in one saved graph', async ({ page, request }) => {
  const before = network.messages.length;
  const flow = await create(request, [
    node('created', 'create', { collection, payload: { title: prefix, status: 'draft' } }, 'updated'),
    node('updated', 'update', { collection, ids: '{{ created.0.id }}', payload: { status: 'review' } }, 'read'),
    node('read', 'read', { collection, ids: '{{ created.0.id }}' }, 'log'),
    node('log', 'log', { message: { proof: prefix, password: 'must-be-redacted' } }, 'mail'),
    node('mail', 'mail', { to: 'recipient@example.test', subject: prefix, text: 'Flow wire-delivery proof' }, 'deleted'),
    node('deleted', 'delete', { collection, ids: '{{ created.0.id }}' }, 'result'),
    node('result', 'transform', { value: { deleted: '{{ deleted.0 }}', status: '{{ read.0.status }}' } }),
  ]);
  await open(page, flow); const result = await run(page, flow); expect(result.status()).toBe(200); expect((await result.json()).data.output).toEqual({ deleted: true, status: 'review' }); expect(await records(request)).toHaveLength(0);
  const fixture = (await (await request.get('/extensions/flow-fixture', { headers })).json()).data;
  expect(fixture.messages.length).toBe(before + 1); expect(fixture.messages.at(-1).raw).toContain(prefix); expect(fixture.messages.at(-1).raw).toContain('Flow wire-delivery proof');
  const logs = (await (await request.get('/extensions/flow-fixture/logs', { headers })).json()).data;
  const proofLogs = logs.filter(log => log.message?.proof === prefix); expect(proofLogs).toHaveLength(1); expect(proofLogs[0].message.password).toBe('[REDACTED]');
  expect(JSON.stringify(logs.filter(log => JSON.stringify(log).includes(prefix)))).not.toContain('must-be-redacted');
  expect(JSON.stringify(logs)).toContain('[REDACTED]'); await expect(page.getByTestId('flow-run-output')).toContainText('review');
});

test('child scripts iterate over arrays through real MySQL and reject oversized arrays and recursive graphs', async ({ page, request }) => {
  const child = await create(request, [node('child', 'script', { code: `export default async (data, context) => context.items('${collection}').createOne({title:'${prefix}-'+data.$trigger.name,status:'draft'});` })], { trigger: 'operation', options: { response: '$last' } });
  const parent = await create(request, [node('batch', 'trigger', { flow: child.id, payload: '{{ $trigger.body.rows }}' })]);
  await open(page, parent); const response = await run(page, parent, { body: { rows: [{ name: 'Ada' }, { name: 'Lin' }] } });
  expect(response.status()).toBe(200); expect((await response.json()).data.output.map(row => row.title)).toEqual([prefix + '-Ada', prefix + '-Lin']); expect(await runs(request, child)).toHaveLength(2);
  expect((await run(page, parent, { body: { rows: Array.from({ length: 101 }, () => ({ name: 'over-limit' })) } })).status()).toBe(400);
  expect((await runs(request, parent))[0].error_code).toBe('FLOW_ITERATION_LIMIT');
  const current = (await (await request.get(`/flows/${child.id}`, { headers })).json()).data;
  current.operations = [node('again', 'trigger', { flow: child.id, payload: {} })]; current.entry = 'again';
  expect((await request.put(`/flows/${child.id}`, { headers, data: current })).status()).toBe(200);
  expect((await run(page, parent, { body: { rows: [{ name: 'recursive' }] } })).status()).toBe(400);
  expect((await runs(request, parent))[0].error_code).toBe('FLOW_RECURSION_LIMIT'); expect((await request.get('/health')).status()).toBe(200);
});

test('actual concurrent HTTP script calls enforce capacity, persist the rejected run and recover their slots', async ({ page, request }) => {
  const flow = await create(request, [node('script', 'script', { code: 'export default async () => { await new Promise(resolve => setTimeout(resolve, 700)); return true; }' })]);
  const responses = await Promise.all(Array.from({ length: 3 }, () => request.post(`/flows/${flow.id}/run`, { headers, data: {} })));
  expect(responses.map(response => response.status()).sort()).toEqual([200, 200, 429]);
  expect((await runs(request, flow)).filter(run => run.error_code === 'FLOW_SCRIPT_BUSY')).toHaveLength(1);
  await open(page, flow); expect((await run(page, flow)).status()).toBe(200); await expect(page.getByTestId('flow-run-output')).toContainText('true');
});

test('queued revisions are skipped after an edit and real schedule polling continues during a slow job', async ({ page, request }) => {
  test.setTimeout(40000);
  const slow = await create(request, [node('wait', 'sleep', { milliseconds: 4500 })], { trigger: 'event', options: { mode: 'action', events: ['items.create'], collections: [collection] } });
  const queued = await create(request, [node('created', 'create', { collection, payload: { title: prefix + '-must-not-run', status: 'draft' } })], { trigger: 'event', options: { mode: 'action', events: ['items.create'], collections: [collection] } });
  const result = await request.post(`/items/${collection}`, { headers, data: { title: prefix + '-original' } }); expect(result.status()).toBe(201);
  await expect.poll(async () => (await runs(request, slow))[0]?.status, { timeout: 10000 }).toBe('running');
  expect((await runs(request, queued))[0].status).toBe('pending'); await pause(request, queued);
  const scheduled = await create(request, [node('value', 'transform', { value: '{{ $trigger.scheduled_at }}' })], { trigger: 'schedule', accountability: 'public', options: { cron: '* * * * * *', response: '$last' } });
  await expect.poll(async () => (await runs(request, scheduled)).length, { timeout: 4000, intervals: [100] }).toBeGreaterThanOrEqual(2);
  await pause(request, scheduled);
  await expect.poll(async () => (await runs(request, queued))[0]?.status, { timeout: 12000 }).toBe('skipped');
  expect((await records(request)).some(row => row.title.endsWith('must-not-run'))).toBe(false);
  await pause(request, slow); await open(page, queued); await expect(page.locator('.flow-history')).toContainText('FLOW_DEFINITION_CHANGED');
});

test('a queued trigger actor losing active status is denied when the real worker claims its job', async ({ page, request }) => {
  test.setTimeout(30000);
  const slow = await create(request, [node('wait', 'sleep', { milliseconds: 2500 })], { trigger: 'event', options: { mode: 'action', events: ['items.create'], collections: [collection] } });
  const queued = await create(request, [node('created', 'create', { collection, payload: { title: prefix + '-denied', status: 'draft' } })], { trigger: 'event', options: { mode: 'action', events: ['items.create'], collections: [collection] } });
  const staff = await login(request, 'content-writer@example.test'), actor = config.users.find(user => user.email === 'content-writer@example.test');
  const response = await request.post(`/items/${collection}`, { headers: { authorization: `Bearer ${staff.access_token}` }, data: { title: prefix + '-original' } }); expect(response.status()).toBe(201);
  await expect.poll(async () => (await runs(request, slow))[0]?.status, { timeout: 10000 }).toBe('running');
  expect((await request.patch(`/users/${actor.id}`, { headers, data: { status: 'suspended' } })).status()).toBe(200);
  try {
    await expect.poll(async () => (await runs(request, queued))[0]?.status, { timeout: 10000 }).toBe('failed');
    expect((await runs(request, queued))[0].error_code).toBe('FLOW_ACTOR_UNAVAILABLE');
    expect((await records(request)).some(row => row.title.endsWith('denied'))).toBe(false);
    await pause(request, slow); await pause(request, queued); await open(page, queued); await expect(page.locator('.flow-history')).toContainText('FLOW_ACTOR_UNAVAILABLE');
  } finally { expect((await request.patch(`/users/${actor.id}`, { headers, data: { status: 'active' } })).status()).toBe(200); }
});
