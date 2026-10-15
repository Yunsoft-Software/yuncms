import { test, expect } from '@playwright/test';

const collection = 'browser_flow_records';
async function session(request, email) {
  const response = await request.post('/auth/login', { data: { email, password: 'Browser-flow-fixture-123!' } }); expect(response.status()).toBe(200);
  return (await response.json()).data;
}
async function open(page, request, email, path = `/#/content/${collection}`) {
  const value = await session(request, email);
  await page.addInitScript(data => { sessionStorage.setItem('yuncms.studio.session', JSON.stringify(data)); localStorage.setItem('yuncms.studio.locale', 'en'); }, value);
  await page.goto(path); return { authorization: `Bearer ${value.access_token}` };
}
async function create(request, headers, title, status = 'draft') {
  const response = await request.post(`/items/${collection}`, { headers, data: { title, status } }); expect(response.status()).toBe(201); return (await response.json()).data;
}

test('issue 76: read/update users never see create, row delete or bulk delete on desktop or mobile', async ({ page, request }) => {
  const headers = await open(page, request, 'flows-staff@example.test');
  await expect(page.locator('tbody tr').first()).toBeVisible();
  await expect(page.getByRole('button', { name: 'New record', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Delete', exact: true })).toHaveCount(0);
  await page.locator('tbody input[type="checkbox"]').first().check();
  await expect(page.getByRole('button', { name: 'Delete selected', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Quick edit', exact: true }).first()).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole('button', { name: 'Delete', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'New record', exact: true })).toHaveCount(0);
  expect((await request.post(`/items/${collection}`, { headers, data: { title: 'Forbidden' } })).status()).toBe(403);
  expect((await request.get(`/studio-navigation/collections/${collection}/capabilities?ids=${encodeURIComponent('[1e309]')}`, { headers })).status()).toBe(400);
});

test('read-only users can inspect records but cannot save through inspector, full editor or a direct new route', async ({ page, request }) => {
  const headers = await open(page, request, 'content-reader@example.test');
  const response = await request.get(`/items/${collection}`, { headers }); const record = (await response.json()).data[0];
  await expect(page.locator('tbody tr').first()).toBeVisible();
  for (const name of ['Quick edit', 'Edit', 'Delete', 'New record']) await expect(page.getByRole('button', { name, exact: true })).toHaveCount(0);
  await page.locator('tbody tr').first().click();
  await expect(page.getByRole('dialog')).toBeVisible(); await expect(page.getByRole('button', { name: 'Save record', exact: true })).toHaveCount(0);
  await expect(page.getByRole('dialog').locator('input').first()).toBeDisabled();
  await page.goto(`/#/content/${collection}/${record.id}`);
  await expect(page.locator('.record-editor')).toBeVisible(); await expect(page.getByRole('button', { name: 'Save record', exact: true })).toHaveCount(0);
  await page.goto(`/#/content/${collection}/new`);
  await expect(page.locator('.record-editor')).toBeVisible(); await expect(page.getByRole('button', { name: 'Save record', exact: true })).toHaveCount(0);
  expect((await request.patch(`/items/${collection}/${record.id}`, { headers, data: { title: 'Denied' } })).status()).toBe(403);
});

test('native row filters hide mutation actions per record and the editor exposes only writable fields', async ({ page, request }) => {
  const admin = await session(request, 'flows-admin@example.test'), headers = { authorization: `Bearer ${admin.access_token}` };
  const allowed = await create(request, headers, 'Allowed action row'), locked = await create(request, headers, 'Locked action row', 'locked');
  try {
    const staffHeaders = await open(page, request, 'content-filtered@example.test');
    const allowedRow = page.locator('tbody tr').filter({ hasText: allowed.id }), lockedRow = page.locator('tbody tr').filter({ hasText: locked.id });
    await expect(allowedRow.getByRole('button', { name: 'Delete', exact: true })).toBeVisible();
    await expect(lockedRow.getByRole('button', { name: 'Delete', exact: true })).toHaveCount(0);
    await expect(lockedRow.getByRole('button', { name: 'Edit', exact: true })).toHaveCount(0);
    await allowedRow.getByRole('button', { name: 'Edit', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Save record', exact: true })).toBeVisible();
    await expect(page.locator('.record-editor').getByLabel('title', { exact: true })).toHaveCount(0);
    await expect(page.locator('.record-editor').getByLabel('status', { exact: true })).toBeVisible();
    expect((await request.delete(`/items/${collection}/${locked.id}`, { headers: staffHeaders })).status()).toBe(404);
    expect((await request.get(`/items/${collection}/${locked.id}`, { headers })).status()).toBe(200);
    expect((await request.patch(`/items/${collection}/${allowed.id}`, { headers: staffHeaders, data: { title: 'Denied field' } })).status()).toBe(403);
  } finally { for (const item of [allowed, locked]) await request.delete(`/items/${collection}/${item.id}`, { headers }); }
});

test('ordinary CRUD grants retain native create, quick update, confirmed row delete and bulk delete', async ({ page, request }) => {
  const headers = await open(page, request, 'content-writer@example.test');
  const key = crypto.randomUUID(), title = `UI permission regression ${key}`, records = [];
  try {
    await page.getByRole('button', { name: 'New record', exact: true }).click();
    await page.locator('.record-editor').getByLabel('title', { exact: true }).fill(title);
    await page.locator('.record-editor').getByLabel('status', { exact: true }).fill('draft');
    const creating = page.waitForResponse(response => response.url().endsWith(`/items/${collection}`) && response.request().method() === 'POST');
    await page.getByRole('button', { name: 'Save record', exact: true }).click();
    const created = await creating; expect(created.status()).toBe(201); const item = (await created.json()).data; records.push(item);
    await page.getByRole('searchbox', { name: 'Search', exact: true }).fill(key);
    const row = page.locator('tbody tr').filter({ hasText: item.id }); await expect(row).toBeVisible();
    await row.getByRole('button', { name: 'Quick edit', exact: true }).click();
    const status = page.getByRole('dialog').getByLabel('status', { exact: true }); await status.fill('review'); await expect(status).toHaveValue('review');
    const saving = page.waitForResponse(response => response.url().endsWith(`/items/${collection}/${item.id}`) && response.request().method() === 'PATCH');
    await page.getByRole('dialog').getByRole('button', { name: 'Save record', exact: true }).click();
    const saved = await saving; expect(saved.status()).toBe(200); expect(saved.request().postDataJSON().status).toBe('review');
    await page.getByRole('dialog').getByRole('button', { name: 'Close inspector', exact: true }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0); await expect(row).toContainText('review');
    await row.getByRole('button', { name: 'Delete', exact: true }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Delete record', exact: true }).click(); await expect(row).toHaveCount(0);
    const bulk = [await create(request, headers, `Bulk permission A ${key}`), await create(request, headers, `Bulk permission B ${key}`)]; records.push(...bulk);
    await page.reload(); await page.getByRole('searchbox', { name: 'Search', exact: true }).fill(key);
    for (const record of bulk) await page.locator('tbody tr').filter({ hasText: record.id }).locator('input[type="checkbox"]').check();
    await page.getByRole('button', { name: 'Delete selected', exact: true }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Delete selected', exact: true }).click();
    for (const record of bulk) await expect(page.locator('tbody tr').filter({ hasText: record.id })).toHaveCount(0);
  } finally {
    for (const record of records) expect([204, 404]).toContain((await request.delete(`/items/${collection}/${record.id}`, { headers })).status());
  }
});

test('opening the inspector preserves immediate field focus and typed values across repeated native saves', async ({ page, request }) => {
  const actor = await session(request, 'content-writer@example.test'), headers = { authorization: `Bearer ${actor.access_token}` };
  const title = `Rapid inspector focus ${crypto.randomUUID()}`, record = await create(request, headers, title);
  try {
    await open(page, request, 'content-writer@example.test'); await page.getByRole('searchbox', { name: 'Search', exact: true }).fill(title);
    const row = page.locator('tbody tr').filter({ hasText: record.id });
    for (let index = 0; index < 5; index++) {
      await row.getByRole('button', { name: 'Quick edit', exact: true }).click();
      const field = page.getByRole('dialog').getByLabel('status', { exact: true }), value = `review-${index}`;
      await field.fill(value);
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      await expect(field).toBeFocused(); await expect(field).toHaveValue(value);
      const saving = page.waitForResponse(response => response.url().endsWith(`/items/${collection}/${record.id}`) && response.request().method() === 'PATCH');
      await page.getByRole('dialog').getByRole('button', { name: 'Save record', exact: true }).click();
      const saved = await saving; expect(saved.status()).toBe(200); expect(saved.request().postDataJSON().status).toBe(value);
      await page.getByRole('dialog').getByRole('button', { name: 'Close inspector', exact: true }).click();
      await expect(page.getByRole('dialog')).toHaveCount(0); await expect(row).toContainText(value);
    }
  } finally { expect((await request.delete(`/items/${collection}/${record.id}`, { headers })).status()).toBe(204); }
});

test('closing an inspector during a real blocking Flow update keeps it closed when the save completes', async ({ page, request }) => {
  const admin = await session(request, 'flows-admin@example.test'), adminHeaders = { authorization: `Bearer ${admin.access_token}` };
  const record = await create(request, adminHeaders, 'Close during native save');
  const response = await request.post('/flows', { headers: adminHeaders, data: { name: 'Slow native update for inspector regression', status: 'active', trigger: 'event', accountability: 'trigger', options: { mode: 'filter', events: ['items.update'], collections: [collection] }, entry: 'wait', operations: [{ id: 'wait', key: 'wait', name: 'Native delay', type: 'sleep', options: { milliseconds: 1500 }, position: { x: 380, y: 100 }, resolve: null, reject: null }] } });
  expect(response.status()).toBe(201); const flow = (await response.json()).data;
  try {
    await open(page, request, 'content-writer@example.test');
    const row = page.locator('tbody tr').filter({ hasText: record.id }); await row.getByRole('button', { name: 'Quick edit', exact: true }).click();
    await page.getByRole('dialog').getByLabel('status', { exact: true }).fill('review');
    const saving = page.waitForResponse(result => result.url().endsWith(`/items/${collection}/${record.id}`) && result.request().method() === 'PATCH');
    await page.getByRole('dialog').getByRole('button', { name: 'Save record', exact: true }).click();
    await expect(page.getByRole('dialog').getByLabel('status', { exact: true })).toBeDisabled();
    const close = page.getByRole('dialog').getByRole('button', { name: 'Close inspector', exact: true });
    await expect(close).toBeInViewport({ ratio: 1 }); await close.click(); await expect(page.getByRole('dialog')).toHaveCount(0);
    const saved = await saving; expect(saved.status()).toBe(200); expect(saved.request().postDataJSON().status).toBe('review');
    await expect(row).toContainText('review'); await expect(page.getByRole('dialog')).toHaveCount(0);
  } finally { await request.delete(`/flows/${flow.id}?revision=${flow.revision}`, { headers: adminHeaders }); await request.delete(`/items/${collection}/${record.id}`, { headers: adminHeaders }); }
});
