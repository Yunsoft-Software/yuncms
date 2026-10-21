import { test, expect } from '@playwright/test';
import { randomUUID } from 'node:crypto';

async function fixture(request) {
  const r = await request.post('/auth/login', { data: { email: 'flows-admin@example.test', password: 'Browser-flow-fixture-123!' } });
  expect(r.status()).toBe(200); const session = (await r.json()).data, headers = { authorization: `Bearer ${session.access_token}` };
  const configuration = (await (await request.get('/automations/configuration', { headers })).json()).data;
  const actor = configuration.users.find(user => user.email === 'flows-staff@example.test'); expect(actor?.id).toBeTruthy();
  return { session, headers, actor };
}
async function editor(page, session, actor, name) {
  await page.addInitScript(session => { sessionStorage.setItem('yuncms.studio.session', JSON.stringify(session)); localStorage.setItem('yuncms.studio.locale', 'en'); }, session);
  await page.goto('/#/automations');
  await page.getByLabel('Name', { exact: true }).fill(name);
  await page.getByRole('combobox', { name: 'Collection', exact: true }).selectOption('browser_flow_records');
  await page.getByRole('combobox', { name: /^Run as/ }).selectOption(actor.id);
  await page.getByRole('group', { name: 'Input fields', exact: true }).locator('label').filter({ hasText: 'title' }).getByRole('checkbox').check();
  await page.getByRole('group', { name: 'Output fields', exact: true }).locator('label').filter({ hasText: 'status' }).getByRole('checkbox').check();
  await page.getByRole('combobox', { name: /must equal input/ }).selectOption('title');
  await page.getByLabel('AI instruction', { exact: true }).fill('Copy title verbatim into status. Return only the status JSON field.');
}

test('Studio declares and persists exact equality and previews the actual provider without writing', async ({ page, request }) => {
  const { session, headers, actor } = await fixture(request), name = 'Constrained browser ' + randomUUID().slice(0, 8);
  const source = 'Owned native-json-' + randomUUID();
  const created = await request.post('/items/browser_flow_records', { headers, data: { title: source, status: 'Original summary' } }); expect(created.status()).toBe(201); const record = (await created.json()).data;
  expect((await request.post('/extensions/flow-fixture/ai/allow', { headers })).status()).toBe(204);
  let id;
  try {
    await editor(page, session, actor, name);
    const saved = page.waitForResponse(r => r.url().endsWith('/automations') && r.request().method() === 'POST');
    await page.getByRole('button', { name: 'Save', exact: true }).click(); const response = await saved; expect(response.status()).toBe(201);
    const rule = (await response.json()).data; id = rule.id;
    expect(rule.output_constraints).toEqual({ status: { must_equal_input: 'title' } });
    await page.reload(); await page.getByRole('button', { name: new RegExp(name) }).click();
    await expect(page.getByRole('combobox', { name: /must equal input/ })).toHaveValue('title');
    await page.getByLabel('Sample record key', { exact: true }).fill(String(record.id));
    const preview = page.waitForResponse(r => r.url().endsWith('/automations/preview') && r.request().method() === 'POST');
    await page.getByRole('button', { name: 'Test on a record', exact: true }).click(); const proposed = await preview; expect(proposed.status()).toBe(200);
    expect((await proposed.json()).data.proposed.status).toBe(source);
    await expect(page.locator('.automation-preview pre').last()).toContainText(source);
    const row = (await (await request.get('/items/browser_flow_records/' + record.id, { headers })).json()).data;
    expect(row.title).toBe(source); expect(row.status).toBe('Original summary');
  } finally { if (id) expect((await request.delete('/automations/' + id, { headers })).status()).toBe(204); expect((await request.post('/extensions/flow-fixture/ai/deny', { headers })).status()).toBe(204); }
});

test('Studio requires explicit binding removal before its field or collection can move', async ({ page, request }) => {
  const { session, actor } = await fixture(request); await editor(page, session, actor, 'Constraint dependency browser');
  const input = page.getByRole('group', { name: 'Input fields', exact: true }).locator('label').filter({ hasText: 'title' }).getByRole('checkbox');
  await input.click(); await expect(page.getByRole('alert')).toContainText('Remove the equality constraint'); await expect(input).toBeChecked();
  await page.getByRole('combobox', { name: 'Collection', exact: true }).selectOption('');
  await expect(page.getByRole('combobox', { name: 'Collection', exact: true })).toHaveValue('browser_flow_records');
  await page.getByRole('combobox', { name: /must equal input/ }).selectOption('');
  await input.uncheck(); await expect(input).not.toBeChecked();
});

test('ordinary users cannot access the constraint editor or administrator rule API', async ({ page, request }) => {
  const r = await request.post('/auth/login', { data: { email: 'flows-staff@example.test', password: 'Browser-flow-fixture-123!' } }); expect(r.status()).toBe(200);
  const session = (await r.json()).data; await page.addInitScript(session => { sessionStorage.setItem('yuncms.studio.session', JSON.stringify(session)); localStorage.setItem('yuncms.studio.locale', 'en'); }, session);
  await page.goto('/#/automations'); await expect(page.getByText('Only administrators can manage AI automations.')).toBeVisible();
  await expect(page.getByRole('combobox', { name: /must equal input/ })).toHaveCount(0);
  expect((await request.get('/automations', { headers: { authorization: `Bearer ${session.access_token}` } })).status()).toBe(403);
});
