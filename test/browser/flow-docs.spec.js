import { readFileSync } from 'node:fs';
import { test, expect } from '@playwright/test';
import { isolateCreatedFlows } from './fixtures/flow-isolation.js';

isolateCreatedFlows(test);

const output = '.yuncms/flows-tests';
const example = name => JSON.parse(readFileSync(new URL(`../../docs/examples/flows/${name}.json`, import.meta.url), 'utf8'));
async function login(request, email = 'flows-admin@example.test') {
  const response = await request.post('/auth/login', { data: { email, password: 'Browser-flow-fixture-123!' } });
  expect(response.status()).toBe(200); return (await response.json()).data;
}
async function authenticate(page, session) {
  await page.addInitScript(value => {
    sessionStorage.setItem('yuncms.studio.session', JSON.stringify(value)); localStorage.setItem('yuncms.studio.locale', 'en');
  }, session);
  await page.setViewportSize({ width: 1920, height: 1200 });
}
async function create(request, session, name, patch = {}) {
  const response = await request.post('/flows', { headers: { authorization: `Bearer ${session.access_token}` }, data: { ...example(name), ...patch } });
  expect(response.status()).toBe(201); return (await response.json()).data;
}
async function run(page, payload) {
  const oldHistory = page.getByRole('dialog', { name: 'Run history', exact: true });
  if (await oldHistory.isVisible()) await oldHistory.getByRole('button', { name: 'Close', exact: true }).click();
  await page.getByRole('button', { name: 'Run saved flow', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Run saved flow', exact: true });
  await dialog.getByLabel('Trigger payload (JSON)', { exact: true }).fill(JSON.stringify(payload));
  await dialog.getByRole('button', { name: 'Run saved flow', exact: true }).click();
  await expect(dialog).not.toBeVisible();
}

test('documented greeting imports through Studio, edits as typed JSON and executes the published example', async ({ page, request }) => {
  const session = await login(request); await authenticate(page, session); await page.goto('/#/flows/new');
  await page.getByRole('button', { name: 'Import', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Flow definition (JSON)', { exact: true }).fill(JSON.stringify(example('manual-greeting')));
  await dialog.getByRole('button', { name: 'Import', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Import', exact: true })).toHaveCount(0);
  await expect(page.locator('.flow-inspector').getByLabel('Status', { exact: true })).toHaveValue('inactive');
  await page.locator('.flow-inspector').getByLabel('Status', { exact: true }).selectOption('active');
  await page.getByRole('button', { name: 'Save', exact: true }).click(); await expect(page).toHaveURL(/#\/flows\/[a-f0-9-]+$/);
  await page.locator('.react-flow__node[data-id="greeting"]').click();
  await expect(page.getByLabel('Operation options (JSON)', { exact: true })).toHaveValue(/\$trigger.body.name/);
  await page.locator('.flow-inspector').screenshot({ path: `${output}/${test.info().project.name}/docs-flow-operation.png` });
  await page.getByRole('button', { name: 'Run saved flow', exact: true }).click();
  const confirmation = page.getByRole('dialog');
  await confirmation.getByLabel('Trigger payload (JSON)', { exact: true }).fill('{"body":{"name":"YunCMS"}}');
  await confirmation.screenshot({ path: `${output}/${test.info().project.name}/docs-flow-run-dialog.png` });
  await confirmation.getByRole('button', { name: 'Run saved flow', exact: true }).click();
  await expect(page.getByTestId('flow-run-output')).toContainText('Hello YunCMS');
});

test('documented approval graph runs both paths and renders the shared result and handled failure trace', async ({ page, request }) => {
  const session = await login(request); await authenticate(page, session);
  const flow = await create(request, session, 'approval-branches', { status: 'active' });
  await page.goto(`/#/flows/${flow.id}`); await expect(page.locator('.react-flow__edge')).toHaveCount(5);
  await run(page, { body: { approved: true } }); await expect(page.getByTestId('flow-run-output')).toContainText('approved');
  await run(page, { body: { approved: false } }); await expect(page.getByTestId('flow-run-output')).toContainText('needs_review');
  await expect(page.locator('.flow-node-failed')).toHaveCount(1);
  await page.getByRole('dialog', { name: 'Run history', exact: true }).getByRole('button', { name: 'Close', exact: true }).click();
  await page.locator('.flow-workbench').screenshot({ path: `${output}/${test.info().project.name}/docs-flow-branches.png` });
  await page.getByRole('button', { name: 'Run history', exact: true }).click();
  await expect(page.getByTestId('flow-run-output')).toContainText('needs_review');
  await page.getByRole('dialog', { name: 'Run history', exact: true }).screenshot({ path: `${output}/${test.info().project.name}/docs-flow-history.png` });
});

test('documented webhook access and schedule configuration match the native API and inspector', async ({ page, request }) => {
  const session = await login(request); await authenticate(page, session);
  const webhook = await create(request, session, 'webhook-greeting', { status: 'active' });
  const path = `/flows/trigger/${webhook.id}`;
  expect((await request.post(path, { data: { name: 'YunCMS' } })).status()).toBe(403);
  const response = await request.post(path, { headers: { authorization: `Bearer ${session.access_token}` }, data: { name: 'YunCMS' } });
  expect(response.status()).toBe(200); expect((await response.json()).data.output.message).toBe('Hello YunCMS');
  await page.goto(`/#/flows/${webhook.id}`); await expect(page.getByLabel('Webhook URL')).toHaveValue(new RegExp(webhook.id));
  await expect(page.getByLabel('Allow requests without authentication')).not.toBeChecked();
  await page.locator('.flow-inspector').screenshot({ path: `${output}/${test.info().project.name}/docs-flow-webhook.png` });
  const config = await request.get('/flows/configuration', { headers: { authorization: `Bearer ${session.access_token}` } });
  const staff = (await config.json()).data.users.find(user => user.email === 'flows-staff@example.test');
  const schedule = await create(request, session, 'schedule-read', { run_as: staff.id, operations: example('schedule-read').operations.map(node => ({ ...node, options: { ...node.options, collection: 'browser_flow_records' } })) });
  await page.goto(`/#/flows/${schedule.id}`);
  await page.reload(); // Refresh the manager catalogue after creating another definition through the API.
  await expect(page.getByLabel('Cron expression (UTC)')).toHaveValue('0 0 8 * * *');
  await expect(page.getByLabel('Run as')).toHaveValue(staff.id);
  await page.locator('.flow-inspector').screenshot({ path: `${output}/${test.info().project.name}/docs-flow-schedule.png` });
});

test('documented Content action confirms a selected record and updates status under ordinary user permissions', async ({ page, request }) => {
  const admin = await login(request), headers = { authorization: `Bearer ${admin.access_token}` };
  const config = (await (await request.get('/flows/configuration', { headers })).json()).data;
  const staffRole = config.roles.find(role => role.name === 'Browser flow staff');
  const definition = example('manual-content-review');
  await create(request, admin, 'manual-content-review', { status: 'active', options: { ...definition.options, collections: ['browser_flow_records'], allowed_roles: [staffRole.id] }, operations: definition.operations.map(node => ({ ...node, options: { ...node.options, collection: 'browser_flow_records' } })) });
  const staff = await login(request, 'flows-staff@example.test'); await authenticate(page, staff);
  const staffHeaders = { authorization: `Bearer ${staff.access_token}` };
  expect((await request.post('/items/browser_flow_records', { headers: staffHeaders, data: { title: 'Must be denied', status: 'draft' } })).status()).toBe(403);
  const records = (await (await request.get('/items/browser_flow_records', { headers: staffHeaders })).json()).data;
  expect((await request.delete(`/items/browser_flow_records/${records[0].id}`, { headers: staffHeaders })).status()).toBe(403);
  await page.setViewportSize({ width: 1440, height: 1000 }); await page.goto('/#/content/browser_flow_records');
  const action = page.getByRole('button', { name: 'Mark for review', exact: true }); await expect(action).toBeDisabled();
  await page.locator('tbody input[type="checkbox"]').first().check();
  await page.screenshot({ path: `${output}/${test.info().project.name}/docs-flow-content-action.png` });
  await action.click();
  await expect(page.getByRole('dialog')).toContainText('Set the selected records to review status?');
  await page.screenshot({ path: `${output}/${test.info().project.name}/docs-flow-content-confirmation.png` });
  await page.getByRole('dialog').getByRole('button', { name: 'Run saved flow', exact: true }).click();
  await expect(page.getByText('Flow finished.', { exact: true })).toBeVisible();
  await expect(page.locator('tbody')).toContainText('review');
});

test('documented blocking hook displays the before-write mode and deliberately omits a replacement response', async ({ page, request }) => {
  const session = await login(request); await authenticate(page, session);
  const definition = example('event-title-required');
  const flow = await create(request, session, 'event-title-required', { options: { ...definition.options, collections: ['browser_flow_records'] } });
  await page.goto(`/#/flows/${flow.id}`);
  await expect(page.getByLabel('Event mode')).toHaveValue('filter');
  await expect(page.getByLabel('Response data-chain path')).toHaveValue('');
  await page.locator('.flow-inspector').screenshot({ path: `${output}/${test.info().project.name}/docs-flow-event-filter.png` });
});
