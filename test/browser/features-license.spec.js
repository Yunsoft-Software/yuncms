import { test, expect } from '@playwright/test';
const collection = 'browser_flow_records';
async function open(page, request, path = '/#/features', email = 'flows-admin@example.test') {
  const response = await request.post('/auth/login', { data: { email, password: 'Browser-flow-fixture-123!' } });
  expect(response.status()).toBe(200); const session = (await response.json()).data;
  await page.addInitScript(data => { sessionStorage.setItem('yuncms.studio.session', JSON.stringify(data)); localStorage.setItem('yuncms.studio.locale', 'en'); }, session);
  await page.goto(path); return { authorization: `Bearer ${session.access_token}` };
}
async function license(request, headers) {
  const response = await request.post('/extensions/flow-fixture/features/license-token', { headers });
  expect(response.status()).toBe(200); return (await response.json()).data;
}

test('one browser build activates a real signed license, toggles native endpoints and stays bounded across all responsive profiles', async ({ page, request }, info) => {
  const headers = await open(page, request);
  await request.post('/extensions/flow-fixture/features/reset', { headers }); await page.reload();
  await expect(page.getByRole('checkbox', { name: 'Content history', exact: true })).toBeDisabled();
  const prior = (await (await request.get('/studio-settings', { headers })).json()).data;
  try {
    await page.getByLabel('Signed license', { exact: true }).fill(await license(request, headers));
    await page.getByRole('button', { name: 'Activate license', exact: true }).click();
    await expect(page.getByLabel('Signed license', { exact: true })).toHaveValue('');
    await expect(page.getByRole('checkbox', { name: 'Content history', exact: true })).toBeEnabled();
    await page.getByRole('checkbox', { name: 'MCP access', exact: true }).uncheck();
    await expect(page.getByRole('checkbox', { name: 'MCP access', exact: true })).not.toBeChecked();
    await expect(page.getByRole('status').filter({ hasText: 'Saved' })).toBeVisible();
    expect((await request.post('/mcp', { headers, data: {} })).status()).toBe(403);
    await page.getByRole('checkbox', { name: 'MCP access', exact: true }).check();
    await expect(page.getByRole('checkbox', { name: 'MCP access', exact: true })).toBeChecked();
    for (const theme of ['light', 'dark']) {
      expect((await request.patch('/studio-settings', { headers, data: { theme } })).status()).toBe(200);
      for (const width of [360, 390, 768, 820, 1024, 1280, 1536]) {
        await page.setViewportSize({ width, height: width < 700 ? 844 : 1000 });
        await page.goto(`/?feature_theme=${theme}&width=${width}#/features`);
        await expect(page.getByRole('heading', { name: 'Features and license', exact: true })).toBeVisible();
        await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
        await expect(page.getByRole('checkbox', { name: 'Content history', exact: true })).toBeEnabled();
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
        await expect(page.locator('.settings-feature-row').first()).toHaveCSS('display', 'flex');
        await page.screenshot({ path: `.yuncms/v2-development-20261104/screenshots/features-${info.project.name}-${theme}-${width}.png`, fullPage: true, animations: 'disabled' });
      }
    }
  } finally {
    await request.patch('/studio-settings', { headers, data: { theme: prior.theme } });
    await request.post('/extensions/flow-fixture/features/reset', { headers });
  }
});

test('two real editors retain the losing draft on conflict and custom navigation confirmation protects it', async ({ page, context, request }, info) => {
  const headers = await open(page, request, `/#/content/${collection}`);
  const response = await request.post(`/items/${collection}`, { headers, data: { title: `Conflict ${crypto.randomUUID()}`, status: 'draft' } });
  expect(response.status()).toBe(201); const record = (await response.json()).data;
  let other;
  try {
    await page.goto(`/#/content/${collection}/${record.id}`);
    await expect(page.locator('.record-editor').getByLabel('title', { exact: true })).toBeVisible();
    other = await context.newPage();
    await other.addInitScript(data => { sessionStorage.setItem('yuncms.studio.session', data); localStorage.setItem('yuncms.studio.locale', 'en'); }, await page.evaluate(() => sessionStorage.getItem('yuncms.studio.session')));
    await other.goto(`/#/content/${collection}/${record.id}`);
    await expect(page.locator('.record-editor').getByLabel('title', { exact: true })).toBeVisible();
    await expect(other.locator('.record-editor').getByLabel('title', { exact: true })).toBeVisible();
    await page.locator('.record-editor').getByLabel('title', { exact: true }).fill('Committed by first editor');
    await other.locator('.record-editor').getByLabel('title', { exact: true }).fill('Preserved losing draft');
    await page.getByRole('button', { name: 'Save record', exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`#/content/${collection}$`));
    await other.getByRole('button', { name: 'Save record', exact: true }).click();
    await expect(other.getByRole('alert')).toContainText('This record changed after you opened it');
    await expect(other.locator('.record-editor').getByLabel('title', { exact: true })).toHaveValue('Preserved losing draft');
    expect((await (await request.get(`/items/${collection}/${record.id}`, { headers })).json()).data.title).toBe('Committed by first editor');
    for (const width of [360, 820, 1536]) {
      await other.setViewportSize({ width, height: 1000 });
      expect(await other.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
      await other.screenshot({ path: `.yuncms/v2-development-20261104/screenshots/conflict-${info.project.name}-${width}.png`, fullPage: true });
    }
    await other.locator('.record-editor').getByRole('button', { name: 'Cancel', exact: true }).click();
    const dialog = other.getByRole('dialog'); await expect(dialog).toBeVisible();
    await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(other.locator('.record-editor').getByLabel('title', { exact: true })).toHaveValue('Preserved losing draft');
    await other.evaluate(() => { location.hash = '#/files'; });
    await expect(dialog).toBeVisible(); await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(other).toHaveURL(new RegExp(`#/content/${collection}/${record.id}$`));
  } finally { await other?.close(); await request.delete(`/items/${collection}/${record.id}`, { headers }); }
});

test('Premium administrator history restores a native revision through the same editor; unprivileged users cannot manage licenses', async ({ page, request }, info) => {
  const headers = await open(page, request);
  const config = (await (await request.get(`/schema/collections/${collection}`, { headers })).json()).data;
  const priorTheme = (await (await request.get('/studio-settings', { headers })).json()).data.theme;
  let record;
  try {
    const token = await license(request, headers);
    expect((await request.post('/features/license', { headers, data: { token } })).status()).toBe(200);
    await page.reload();
    await page.getByLabel('Collection', { exact: true }).selectOption(collection);
    await page.getByRole('checkbox', { name: 'Record content changes', exact: true }).check();
    await expect(page.getByRole('checkbox', { name: 'Record content changes', exact: true })).toBeEnabled();
    expect((await (await request.get(`/schema/collections/${collection}`, { headers })).json()).data.metadata.contentTracking.history).toBe(true);
    const response = await request.post(`/items/${collection}`, { headers, data: { title: 'Historical original', status: 'draft' } });
    expect(response.status()).toBe(201); record = (await response.json()).data;
    expect((await request.patch(`/items/${collection}/${record.id}`, { headers, data: { title: 'Newer live value' } })).status()).toBe(200);
    await page.goto(`/#/content/${collection}/${record.id}`);
    await page.getByRole('button', { name: 'Content history', exact: true }).click();
    await page.getByRole('button', { name: /Revision 1/ }).click();
    await expect(page.getByRole('dialog').locator('pre').filter({ hasText: 'Historical original' })).toBeVisible();
    for (const theme of ['light', 'dark']) {
      expect((await request.patch('/studio-settings', { headers, data: { theme } })).status()).toBe(200);
      await page.goto(`/?history_theme=${theme}#/content/${collection}/${record.id}`);
      await page.getByRole('button', { name: 'Content history', exact: true }).click();
      await page.getByRole('button', { name: /Revision 1/ }).click();
      await expect(page.getByRole('dialog').locator('pre').filter({ hasText: 'Historical original' })).toBeVisible();
      for (const width of [320, 390, 768, 820, 1100, 1101, 1536]) {
        await page.setViewportSize({ width, height: width < 700 ? 844 : 1000 });
        const bounds = await page.getByRole('dialog').evaluate(element => { const r = element.getBoundingClientRect(); return { left: r.left, right: r.right }; });
        expect(bounds.left).toBeGreaterThanOrEqual(-1); expect(bounds.right).toBeLessThanOrEqual(width + 1);
        await page.screenshot({ path: `.yuncms/v2-development-20261104/screenshots/history-${info.project.name}-${theme}-${width}.png`, fullPage: true, animations: 'disabled' });
      }
      if (theme === 'light') await page.getByRole('dialog').getByRole('button', { name: 'Close', exact: true }).click();
    }
    await page.getByRole('button', { name: 'Restore this revision', exact: true }).click();
    await page.getByRole('dialog').filter({ has: page.getByRole('heading', { name: 'Restore this revision', exact: true }) }).getByRole('button', { name: 'Confirm', exact: true }).click();
    await expect(page.locator('.record-editor').getByLabel('title', { exact: true })).toHaveValue('Historical original');
    expect((await (await request.get(`/items/${collection}/${record.id}`, { headers })).json()).data.title).toBe('Historical original');
    await page.getByRole('dialog').getByRole('button', { name: 'Close', exact: true }).click();
    const staff = await page.context().newPage();
    try {
      await open(staff, request, '/#/features', 'flows-staff@example.test');
      await expect(staff.getByRole('heading', { name: 'Features and license', exact: true })).toHaveCount(0);
      await expect(staff.getByRole('alert')).toBeVisible();
    } finally { await staff.close(); }
  } finally {
    if (record) await request.delete(`/items/${collection}/${record.id}`, { headers });
    await request.patch(`/schema/collections/${collection}`, { headers, data: { metadata: config.metadata } });
    await request.patch('/studio-settings', { headers, data: { theme: priorTheme } });
    await request.post('/extensions/flow-fixture/features/reset', { headers });
  }
});
