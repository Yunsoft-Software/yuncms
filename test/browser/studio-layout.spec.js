import { test, expect } from '@playwright/test';
import { seedStudioLayout, cleanupStudioLayout } from '../helpers/studio-layout-fixture.mjs';

let fixture, session, headers;
function nativeSend(request) {
  return async (path, { method = 'GET', body } = {}) => {
    const response = await request.fetch(path, { method, headers, ...(body === undefined ? {} : { data: body }) });
    if (response.status() === 204) return null;
    const result = await response.json();
    expect(response.ok(), `${method} ${path}: ${JSON.stringify(result)}`).toBeTruthy(); return result.data;
  };
}
async function open(page, path) {
  await page.addInitScript(value => {
    sessionStorage.setItem('yuncms.studio.session', JSON.stringify(value));
    localStorage.setItem('yuncms.studio.locale', 'en');
  }, session);
  await page.goto(path);
}
async function setAppearance(request, theme, accent = '#2563eb') {
  const response = await request.patch('/studio-settings', { headers, data: { theme, accent_color: accent } }); expect(response.status()).toBe(200);
}
async function expectContained(page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
}

test.beforeAll(async ({ request }) => {
  const response = await request.post('/auth/login', { data: { email: 'flows-admin@example.test', password: 'Browser-flow-fixture-123!' } });
  expect(response.status()).toBe(200); session = (await response.json()).data; headers = { authorization: `Bearer ${session.access_token}` };
  fixture = await seedStudioLayout(nativeSend(request), crypto.randomUUID().replaceAll('-', '').slice(0, 8));
});
test.afterAll(async ({ request }) => {
  if (fixture) await cleanupStudioLayout(nativeSend(request), fixture);
  await setAppearance(request, 'system');
});

test('long content and high-cardinality relations keep bounded rows, full values and usable actions in both themes', async ({ page, request }, testInfo) => {
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  for (const theme of ['light', 'dark']) {
    await setAppearance(request, theme);
    await open(page, `/#/content/${fixture.parent}`);
    const row = page.locator('tbody tr').filter({ hasText: fixture.article.id });
    await expect(row).toBeVisible(); await expect(row.locator('.nested-count-badge').getByText('+22', { exact: true })).toBeVisible();
    await expect(row.locator('.nested-translation-title')).toHaveCount(2);
    await expect(row.locator('.nested-m2m-chip')).toHaveCount(2);
    expect(await row.evaluate(element => element.getBoundingClientRect().height)).toBeLessThanOrEqual(160);
    await expect(row.locator('.content-column-identity .table-cell-text')).toHaveAttribute('title', fixture.article.id);
    await expect(row.getByRole('button', { name: 'Quick edit', exact: true })).toBeInViewport({ ratio: 1 });
    await expectContained(page);
    await page.screenshot({ path: `.yuncms/studio-refresh-20261104/content-${testInfo.project.name}-${theme}.png`, fullPage: true });
    await row.getByRole('button', { name: 'Quick edit', exact: true }).click();
    const inspector = page.getByRole('dialog'); await expect(inspector).toBeVisible();
    await expect(inspector.locator('.record-editor > fieldset [data-field="title"] input')).toHaveValue(fixture.longTitle);
    await expect(inspector.locator('[data-field="description"] textarea')).toHaveValue(fixture.longText);
    await expect(inspector.getByRole('button', { name: 'Close inspector', exact: true })).toBeInViewport({ ratio: 1 });
    await inspector.getByRole('button', { name: 'Close inspector', exact: true }).click();
    await expect(inspector).toHaveCount(0);
  }
  expect(errors).toEqual([]);
});

test('new record honors native draft and true defaults through a real save and reload', async ({ page, request }) => {
  await open(page, `/#/content/${fixture.parent}/new`);
  const form = page.locator('.record-editor'); await expect(form).toBeVisible();
  await expect(form.locator('[data-field="status"] select')).toHaveValue('draft');
  await expect(form.locator('[data-field="enabled"] input')).toBeChecked();
  const title = `Default regression ${crypto.randomUUID()}`;
  await form.locator(':scope > fieldset [data-field="title"] input').fill(title);
  const saving = page.waitForResponse(response => new URL(response.url()).pathname === `/items/${fixture.parent}` && response.request().method() === 'POST');
  await form.getByRole('button', { name: 'Save record', exact: true }).click();
  const saved = await saving; expect(saved.status()).toBe(201); const item = (await saved.json()).data;
  try {
    expect(item.status).toBe('draft'); expect([true, 1]).toContain(item.enabled);
    await expect(page).toHaveURL(new RegExp(`#/content/${fixture.parent}$`));
    const response = await request.get(`/items/${fixture.parent}/${item.id}`, { headers }); expect(response.status()).toBe(200);
    expect((await response.json()).data.status).toBe('draft');
    await page.goto(`/#/content/${fixture.parent}/${item.id}`);
    await expect(page.locator('[data-field="status"] select')).toHaveValue('draft');
  } finally { expect((await request.delete(`/items/${fixture.parent}/${item.id}`, { headers })).status()).toBe(204); }
});

test('all Studio workspaces remain contained on desktop, tablet and mobile with a custom accent', async ({ page, request }, testInfo) => {
  await setAppearance(request, 'light', '#0f766e');
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  const paths = [`/content/${fixture.parent}`, `/content/${fixture.child}`, '/files', '/data-model', `/data-model/${fixture.parent}`, '/ai', '/users', '/roles', '/security', '/mcp', '/automations', '/flows', '/appearance'];
  for (const width of [1440, 1024, 390]) {
    await page.setViewportSize({ width, height: 960 });
    for (const path of paths) {
      await open(page, `/#${path}`);
      await page.waitForLoadState('networkidle');
      await expect(page.getByRole('main')).toHaveCount(1);
      await expect(page.locator('main')).toBeVisible();
      await expect(page.locator('main').getByRole('heading').first()).toBeVisible();
      await expect(page.locator('.studio-app-rail-button[aria-current="page"]')).toHaveCount(1);
      await expect(page.locator('main .error-banner')).toHaveCount(0);
      await expectContained(page);
      if (width === 1440 && ['/files', '/data-model', '/roles', '/appearance', '/flows'].includes(path)) {
        await page.screenshot({ path: `.yuncms/studio-refresh-20261104/${path.slice(1)}-${testInfo.project.name}.png`, fullPage: true });
      }
      if (path === `/content/${fixture.parent}`) {
        const surface = width <= 1100 ? page.locator('.mobile-record-list') : page.locator('.table-scroll');
        await expect(surface).toBeVisible();
        await page.screenshot({ path: `.yuncms/studio-refresh-20261104/workspace-${testInfo.project.name}-${width}.png`, fullPage: true });
      }
    }
  }
  expect(errors).toEqual([]);
});
