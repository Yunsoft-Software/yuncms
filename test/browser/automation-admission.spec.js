import { test, expect } from '@playwright/test';

const password = 'Browser-flow-fixture-123!';
async function setup(request) {
  const login = await request.post('/auth/login', { data: { email: 'flows-admin@example.test', password } });
  expect(login.status()).toBe(200);
  const session = (await login.json()).data;
  const headers = { authorization: `Bearer ${session.access_token}` };
  const configuration = await request.get('/automations/configuration', { headers });
  expect(configuration.status()).toBe(200);
  const actor = (await configuration.json()).data.users.find(user => user.email === 'flows-staff@example.test');
  expect(actor?.id).toBeTruthy();
  const created = await request.post('/items/browser_flow_records', { headers, data: { title: 'Admission fixture', status: 'original' } });
  expect(created.status()).toBe(201);
  const record = (await created.json()).data;
  const rule = { name: 'Provider admission regression', collection: 'browser_flow_records', run_as: actor.id,
    enabled: true, on_create: false, on_update: true, input_fields: ['title'], output_fields: ['status'], instruction: 'Copy title to status.' };
  return { session, headers, actor, record, rule };
}

test('Studio automation preview displays admission denial and preserves the record', async ({ page, request }) => {
  const { session, headers, actor, record } = await setup(request);
  await page.addInitScript(session => {
    sessionStorage.setItem('yuncms.studio.session', JSON.stringify(session));
    localStorage.setItem('yuncms.studio.locale', 'en');
  }, session);
  await page.goto('/#/automations');
  await page.getByLabel('Name', { exact: true }).fill('Denied browser preview');
  await page.getByRole('combobox', { name: 'Collection', exact: true }).selectOption('browser_flow_records');
  await page.getByRole('combobox', { name: /^Run as/ }).selectOption(actor.id);
  await page.getByRole('group', { name: 'Input fields', exact: true }).locator('label').filter({ hasText: 'title' }).getByRole('checkbox').check();
  await page.getByRole('group', { name: 'Output fields', exact: true }).locator('label').filter({ hasText: 'status' }).getByRole('checkbox').check();
  await page.getByLabel('AI instruction', { exact: true }).fill('Copy title to status.');
  await page.getByLabel('Sample record key', { exact: true }).fill(String(record.id));
  const preview = page.waitForResponse(response => response.url().endsWith('/automations/preview') && response.request().method() === 'POST');
  await page.getByRole('button', { name: 'Test on a record', exact: true }).click();
  expect((await preview).status()).toBe(402);
  await expect(page.getByRole('alert')).toContainText('AI capacity exhausted');
  const readback = await request.get(`/items/browser_flow_records/${record.id}`, { headers });
  expect((await readback.json()).data.status).toBe('original');
  const evidence = (await (await request.get('/extensions/flow-fixture', { headers })).json()).data.aiAdmissionEvents;
  expect(evidence.at(-1)).toMatchObject({ user: actor.id, admin: false });
  expect(evidence.at(-1).requestId).toBeTruthy();
});

test('native API and polling worker persist admission rejection with the ordinary Run as identity', async ({ request }) => {
  const { headers, actor, record, rule } = await setup(request);
  const created = await request.post('/automations', { headers, data: rule });
  expect(created.status()).toBe(201);
  const id = (await created.json()).data.id;
  try {
    const updated = await request.patch(`/items/browser_flow_records/${record.id}`, { headers, data: { title: 'Queue admission fixture' } });
    expect(updated.status()).toBe(200);
    await expect.poll(async () => {
      const response = await request.get(`/automations/${id}/runs`, { headers });
      expect(response.status()).toBe(200);
      return (await response.json()).data[0]?.status;
    }).toBe('failed');
    const runs = (await (await request.get(`/automations/${id}/runs`, { headers })).json()).data;
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({ status: 'failed', attempts: 1, error_code: 'AI_TOKENS_EXHAUSTED' });
    const readback = await request.get(`/items/browser_flow_records/${record.id}`, { headers });
    expect((await readback.json()).data.status).toBe('original');
    const evidence = (await (await request.get('/extensions/flow-fixture', { headers })).json()).data.aiAdmissionEvents;
    expect(evidence.at(-1)).toMatchObject({ user: actor.id, admin: false });
  } finally {
    expect((await request.delete(`/automations/${id}`, { headers })).status()).toBe(204);
  }
});

test('Studio previews real-provider JSON output and leaves the source record unchanged', async ({ page, request }) => {
  const { session, headers, actor, record } = await setup(request);
  const marker = `json-mode-${Date.now()}`;
  expect((await request.post('/extensions/flow-fixture/ai/allow', { headers })).status()).toBe(204);
  try {
    await page.addInitScript(session => {
      sessionStorage.setItem('yuncms.studio.session', JSON.stringify(session));
      localStorage.setItem('yuncms.studio.locale', 'en');
    }, session);
    await page.goto('/#/automations');
    await page.getByLabel('Name', { exact: true }).fill('Real JSON preview');
    await page.getByRole('combobox', { name: 'Collection', exact: true }).selectOption('browser_flow_records');
    await page.getByRole('combobox', { name: /^Run as/ }).selectOption(actor.id);
    await page.getByRole('group', { name: 'Input fields', exact: true }).locator('label').filter({ hasText: 'title' }).getByRole('checkbox').check();
    await page.getByRole('group', { name: 'Output fields', exact: true }).locator('label').filter({ hasText: 'status' }).getByRole('checkbox').check();
    await page.getByLabel('AI instruction', { exact: true }).fill(`Return only a JSON object with status set to the exact string ${marker}.`);
    await page.getByLabel('Sample record key', { exact: true }).fill(String(record.id));
    const response = page.waitForResponse(response => response.url().endsWith('/automations/preview') && response.request().method() === 'POST');
    await page.getByRole('button', { name: 'Test on a record', exact: true }).click();
    const preview = await response;
    expect(preview.status(), JSON.stringify(await preview.json())).toBe(200);
    await expect(page.locator('.automation-preview pre').last()).toContainText(marker);
    const readback = await request.get(`/items/browser_flow_records/${record.id}`, { headers });
    expect((await readback.json()).data.status).toBe('original');
  } finally {
    expect((await request.post('/extensions/flow-fixture/ai/deny', { headers })).status()).toBe(204);
  }
});
