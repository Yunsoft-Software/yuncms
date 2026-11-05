import { test, expect } from '@playwright/test';
import { seedStudioLayout, cleanupStudioLayout } from '../helpers/studio-layout-fixture.mjs';
import { expectReadableText } from '../helpers/studio-contrast.mjs';

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
  const overflow = await page.locator('main .panel, main .nested-relation-panel, main .nested-language-tabs, main .nested-language-card, main .nested-m2m-grid, main .flow-inspector').evaluateAll(elements => elements.flatMap(element => {
    const rect = element.getBoundingClientRect();
    return rect.width && rect.height && (rect.left < -1 || rect.right > innerWidth + 1)
      ? [{ className: element.className, left: rect.left, right: rect.right, width: rect.width }] : [];
  }));
  expect(overflow, 'hidden document overflow must not conceal an oversized form or panel').toEqual([]);
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
    // A changed query opens the saved theme in a fresh Studio document. An
    // immediate second reload aborts the first document's real boot requests.
    await open(page, `/?layout_theme=${theme}#/content/${fixture.parent}`);
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
    const row = page.locator('tbody tr').filter({ hasText: fixture.longTitle });
    await expect(row).toBeVisible(); await expect(row.locator('.nested-count-badge').getByText('+22', { exact: true })).toBeVisible();
    await expect(row.locator('.nested-translation-title')).toHaveCount(2);
    await expect(row.locator('.nested-m2m-chip')).toHaveCount(2);
    expect(await row.evaluate(element => element.getBoundingClientRect().height)).toBeLessThanOrEqual(160);
    await expect(row.locator('.content-column-identity')).toHaveCount(0);
    await page.locator('.data-view-options-trigger').click();
    await page.locator('.data-view-column-list label').filter({ has: page.locator('small').getByText('id', { exact: true }) }).getByRole('checkbox').check();
    await page.keyboard.press('Escape');
    await expect(row.locator('.content-column-identity .table-cell-text')).toHaveAttribute('title', fixture.article.id);
    await row.getByRole('button', { name: 'Quick edit', exact: true }).scrollIntoViewIfNeeded();
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
    await page.locator('.data-view-options-trigger').click();
    await page.locator('.data-view-column-list label').filter({ has: page.locator('small').getByText('id', { exact: true }) }).getByRole('checkbox').uncheck();
    await page.keyboard.press('Escape');
    await expect(row.locator('.content-column-identity')).toHaveCount(0);
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

test('field-builder accent labels remain legible in both themes with the default and a custom accent', async ({ page, request }, info) => {
  const readable = expectReadableText;
  try {
    for (const theme of ['light', 'dark']) for (const accent of ['#2563eb', '#0f766e']) {
      await setAppearance(request, theme, accent);
      await open(page, '/#/data-model/new');
      await page.reload();
      await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
      await readable(page.locator('.accountability-builder-heading > span small'));
      await readable(page.locator('.accountability-option code').first());
      await page.goto(`/#/data-model/${fixture.parent}/fields/new`);
      await readable(page.locator('.field-config-type'));
      await page.screenshot({ path: info.outputPath(`field-labels-${theme}-${accent.slice(1)}.png`), animations: 'disabled', fullPage: true });
      await page.goto(`/#/content/${fixture.parent}/new`);
      await readable(page.locator('.page-breadcrumbs button').first());
    }
  } finally { await setAppearance(request, 'system'); }
});

test('native account status and verification labels remain readable in every theme and responsive layout', async ({ page, request }, info) => {
  const send = nativeSend(request);
  const user = await send('/users', { method: 'POST', body: { email: `status-${crypto.randomUUID()}@example.test`, password: 'Native-status-fixture-123!' } });
  try {
    for (const theme of ['light', 'dark']) {
      await setAppearance(request, theme);
      for (const width of [390, 820, 1680]) {
        await page.setViewportSize({ width, height: 960 });
        for (const status of ['active', 'suspended', 'disabled']) {
          await send(`/users/${user.id}`, { method: 'PATCH', body: { status } });
          expect((await send(`/users/${user.id}`)).status).toBe(status);
          await open(page, `/?status_appearance=${theme}-${width}-${status}#/users/${user.id}`);
          await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
          const badge = page.locator(`.user-detail-page .user-status-pill.${status}`);
          await expect(badge).toHaveText(status[0].toUpperCase() + status.slice(1));
          await expectReadableText(badge);
          await page.screenshot({ path: info.outputPath(`account-${theme}-${width}-${status}.png`), animations: 'disabled' });
        }
        await page.goto('/#/users');
        const row = page.locator('.mobile-user-card, tbody tr').filter({ hasText: user.email }).filter({ visible: true });
        await expectReadableText(row.getByText('Verified', { exact: true }));
      }
    }
  } finally {
    await send(`/users/${user.id}`, { method: 'DELETE' });
    await setAppearance(request, 'system');
  }
});

test('all Studio workspaces remain contained on desktop, tablet and mobile with a custom accent', async ({ page, request }, testInfo) => {
  await setAppearance(request, 'light', '#0f766e');
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  const paths = [`/content/${fixture.parent}`, `/content/${fixture.child}`, '/files', '/data-model', `/data-model/${fixture.parent}`, '/ai', '/users', '/roles', '/security', '/mcp', '/automations', '/flows', '/appearance'];
  for (const width of [1440, 1024, 915, 390]) {
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
      if (path === '/files' && width <= 1100) {
        const title = await page.locator('.file-category-rail-title').boundingBox();
        const firstCategory = await page.locator('.file-category-list button').first().boundingBox();
        expect(firstCategory.y - title.y - title.height).toBeLessThanOrEqual(10);
      }
    }
  }
  expect(errors).toEqual([]);
});

test('saved appearance loads through native session renewal before the settings form is displayed', async ({ page, request }) => {
  await setAppearance(request, 'dark');
  const login = await request.post('/auth/login', { data: { email: 'flows-admin@example.test', password: 'Browser-flow-fixture-123!' } });
  expect(login.status()).toBe(200);
  const fresh = (await login.json()).data;
  await page.addInitScript(value => {
    sessionStorage.setItem('yuncms.studio.session', JSON.stringify({ ...value, access_token: 'expired-preview-access-token' }));
    localStorage.setItem('yuncms.studio.locale', 'en');
  }, fresh);
  await page.goto('/#/appearance');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await expect(page.getByRole('combobox', { name: 'Theme', exact: true })).toHaveValue('dark');
  await expect(page.locator('.studio-boot')).toHaveCount(0);
});

test('phone and tablet navigation overlays the page, traps focus and closes without shifting content', async ({ page }) => {
  for (const width of [320, 768, 820, 900, 915, 1024, 1100]) {
    await page.setViewportSize({ width, height: 960 });
    await open(page, '/#/flows');
    await expect(page.locator('.flow-catalogue')).toHaveAttribute('aria-busy', 'false');
    const main = page.getByRole('main'), menu = page.getByRole('button', { name: 'Open menu', exact: true });
    await expect(menu).toBeVisible();
    const before = await main.boundingBox();
    expect(before.x).toBe(0); expect(before.width).toBe(width);
    await menu.click();
    const drawer = page.getByRole('dialog', { name: 'Studio sections', exact: true });
    const close = drawer.getByRole('button', { name: 'Close menu', exact: true });
    await expect(close).toBeFocused();
    expect(await main.boundingBox()).toEqual(before);
    const bounds = await drawer.boundingBox();
    expect(bounds.x).toBeGreaterThanOrEqual(0); expect(bounds.x + bounds.width).toBeLessThanOrEqual(width);
    const brand = drawer.locator('.studio-brand');
    await expect(brand).toHaveAttribute('href', 'https://yunsoft.com');
    // The official brand is now a keyboard-accessible link before Close menu.
    // Include it in both directions instead of assuming Close is the first stop.
    await page.keyboard.press('Shift+Tab'); await expect(brand).toBeFocused();
    await page.keyboard.press('Shift+Tab');
    await expect(drawer.getByRole('link').last()).toBeFocused();
    await page.keyboard.press('Tab'); await expect(brand).toBeFocused();
    await page.keyboard.press('Tab'); await expect(close).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(drawer).toHaveCount(0); await expect(menu).toBeFocused();
    await expectContained(page);
  }
});

test('short lists use the available tablet pane and phone card actions share one row', async ({ page }) => {
  await page.setViewportSize({ width: 915, height: 840 });
  await open(page, `/#/content/${fixture.tags}`);
  const panel = page.locator('.content-table-panel-short');
  await expect(panel.locator('.table-scroll')).toBeVisible();
  await expect(panel.locator('.mobile-record-list')).toBeHidden();
  const main = await page.getByRole('main').boundingBox();
  expect(main.x).toBe(0); expect(main.width).toBe(915);
  const controls = page.locator('.data-controls-panel');
  const search = await controls.locator('.control-search input').boundingBox();
  const panelBounds = await controls.boundingBox();
  expect(search.width).toBeGreaterThan(panelBounds.width - 40);
  const visibleSelects = controls.locator('select:visible');
  await expect(visibleSelects).toHaveCount(2);
  for (const control of await visibleSelects.all()) {
    expect((await control.boundingBox()).width).toBeGreaterThanOrEqual(100);
  }
  await page.setViewportSize({ width: 390, height: 844 });
  const cards = panel.locator('.mobile-record-list');
  await expect(cards).toBeVisible();
  await expect(panel.locator('.table-scroll')).toBeHidden();
  const filterButton = await controls.locator('.mobile-filter-toggle').boundingBox();
  const viewButton = await controls.locator('.data-view-options-trigger').boundingBox();
  expect(Math.abs(filterButton.y - viewButton.y)).toBeLessThan(1);
  expect(Math.abs(filterButton.width - viewButton.width)).toBeLessThan(1);
  expect(filterButton.width).toBeGreaterThan(100);
  const actions = cards.locator('.mobile-card-actions').first();
  const buttons = actions.getByRole('button');
  await expect(buttons).toHaveCount(3);
  const bounds = await buttons.evaluateAll(elements => elements.map(element => {
    const rect = element.getBoundingClientRect(); return { y: rect.y, height: rect.height };
  }));
  expect(new Set(bounds.map(rect => Math.round(rect.y))).size).toBe(1);
  expect(bounds.every(rect => rect.height >= 38)).toBe(true);
  await page.setViewportSize({ width: 320, height: 812 });
  const narrowBounds = await buttons.evaluateAll(elements => elements.map(element => {
    const rect = element.getBoundingClientRect(); return { x: rect.x, y: rect.y, width: rect.width };
  }));
  expect(narrowBounds[0].y).toBeLessThan(narrowBounds[1].y);
  expect(narrowBounds[1].y).toBe(narrowBounds[2].y);
  expect(narrowBounds[0].width).toBeGreaterThan(narrowBounds[1].width);
  await expectContained(page);
});

test('24 languages and 520 native relations stay bounded, remain reachable and survive a real editor save', async ({ page, request }, info) => {
  test.setTimeout(240000);
  for (const width of [320, 390, 768, 915, 1024, 1100, 1101, 1680]) {
    await page.setViewportSize({ width, height: 960 });
    await open(page, `/#/content/${fixture.parent}/${fixture.article.id}`);
    const tabs = page.locator('.nested-language-tabs');
    await expect(tabs.getByRole('tab')).toHaveCount(24);
    expect((await tabs.boundingBox()).height).toBeLessThanOrEqual(70);
    await tabs.getByRole('tab', { selected: true }).focus();
    await page.keyboard.press('End');
    await expect(tabs.getByRole('tab', { name: /^ZH / })).toHaveAttribute('aria-selected', 'true');
    await expect(tabs.getByRole('tab', { name: /^ZH / })).toBeInViewport({ ratio: 1 });
    await page.setViewportSize({ width: width === 320 ? 390 : 320, height: 960 });
    await expect.poll(async () => tabs.evaluate(element => {
      const bounds = element.getBoundingClientRect(), active = element.querySelector('[aria-selected="true"]').getBoundingClientRect();
      return active.left >= bounds.left - 1 && active.right <= bounds.right + 1;
    })).toBe(true);
    await page.setViewportSize({ width, height: 960 });
    await expect(page.locator('.nested-language-card[data-lang="zh-CN"]')).toBeVisible();
    await tabs.getByRole('tab', { name: /^AR / }).click();
    await expect(page.locator('.nested-language-card[data-lang="ar-SA"]')).toHaveAttribute('dir', 'rtl');
    const picker = page.locator('.nested-m2m-grid');
    await expect(picker.getByRole('button', { pressed: true })).toHaveCount(520);
    const bounds = await picker.evaluate(element => ({ height: element.clientHeight, content: element.scrollHeight }));
    expect(bounds.height).toBeLessThanOrEqual(480);
    expect(bounds.content).toBeGreaterThan(bounds.height);
    const overflowingLabels = await picker.locator('.nested-m2m-option').evaluateAll(buttons => buttons.flatMap(button => {
      const parent = button.getBoundingClientRect(), label = button.querySelector('.nested-m2m-label').getBoundingClientRect();
      return label.top < parent.top - 1 || label.bottom > parent.bottom + 1 || label.left < parent.left - 1 || label.right > parent.right + 1
        ? [{ button: { x: parent.x, y: parent.y, width: parent.width, height: parent.height }, label: { x: label.x, y: label.y, width: label.width, height: label.height } }] : [];
    }));
    expect(overflowingLabels, 'long labels must remain inside their own selected relation button').toEqual([]);
    expect(await picker.locator('.nested-m2m-option').evaluateAll(buttons => buttons.filter(button => button.getBoundingClientRect().height > 74).length), 'long multi-relation labels must leave several choices visible').toBe(0);
    const label = picker.locator('.nested-m2m-label').first();
    await expect(label).toHaveAttribute('title', await label.textContent());
    await expectContained(page);
    await page.screenshot({ path: `.yuncms/studio-refresh-20261104/stress-${info.project.name}-${width}.jpg`, fullPage: true });
  }
  const arabicTitle = `عنوان محفوظ عبر واجهة النظام ${crypto.randomUUID()}`;
  await page.locator('.nested-language-card[data-lang="ar-SA"] [data-field="title"] input').fill(arabicTitle);
  const saving = page.waitForResponse(response => new URL(response.url()).pathname === `/items/${fixture.parent}/${fixture.article.id}` && response.request().method() === 'PATCH');
  await page.getByRole('button', { name: 'Save record', exact: true }).click();
  expect((await saving).status()).toBe(200);
  await expect(page).toHaveURL(new RegExp(`#/content/${fixture.parent}$`));
  const links = await request.get(`/items/${fixture.junction}?filter=${encodeURIComponent(JSON.stringify({ article_id: { _eq: fixture.article.id } }))}&limit=1`, { headers });
  expect(links.status()).toBe(200); const linkPage = await links.json(); expect(linkPage.meta.total_count).toBe(520);
  const translations = await request.get(`/items/${fixture.child}?filter=${encodeURIComponent(JSON.stringify({ article_id: { _eq: fixture.article.id } }))}&limit=100`, { headers });
  expect(translations.status()).toBe(200);
  const rows = (await translations.json()).data;
  expect(rows).toHaveLength(24);
  expect(rows.map(row => row.id).sort()).toEqual(fixture.translations.map(row => row.id).sort());
  expect(rows.find(row => row.language_code === 'ar-SA').title).toBe(arabicTitle);
  await page.goto(`/#/content/${fixture.parent}/${fixture.article.id}`);
  await expect(page.locator('.nested-m2m-grid').getByRole('button', { pressed: true })).toHaveCount(520);
  await page.getByRole('tab', { name: /^AR / }).click();
  await expect(page.locator('.nested-language-card[data-lang="ar-SA"] [data-field="title"] input')).toHaveValue(arabicTitle);
  const link = linkPage.data[0];
  await page.goto(`/#/content/${fixture.junction}/${link.id}`);
  const relation = page.locator('[data-field="topic_id"] .relation-picker'), trigger = relation.locator('.relation-picker-trigger');
  for (const width of [320, 820, 1680]) {
    await page.setViewportSize({ width, height: 960 });
    await expect(trigger).toHaveAttribute('title', /Topic \d+:/);
    expect(await trigger.evaluate(element => element.getBoundingClientRect().height)).toBeLessThanOrEqual(64);
    await trigger.click();
    await expect(relation.getByRole('option')).toHaveCount(520);
    const tallOptions = await relation.getByRole('option').evaluateAll(elements => elements.filter(element => element.getBoundingClientRect().height > 74).length);
    expect(tallOptions).toBe(0);
    await relation.getByRole('searchbox').fill('Topic 520:');
    await expect(relation.getByRole('option')).toHaveCount(1);
    await expect(relation.getByRole('option').locator('span')).toHaveAttribute('title', /Topic 520:/);
    await relation.getByRole('option').click();
    await expect(trigger).toHaveAttribute('title', /Topic 520:/);
    expect(await trigger.evaluate(element => element.getBoundingClientRect().height)).toBeLessThanOrEqual(64);
    await page.screenshot({ path: info.outputPath(`relation-choice-${width}.png`), animations: 'disabled', fullPage: true });
  }
  const unchanged = await request.get(`/items/${fixture.junction}/${link.id}`, { headers }); expect(unchanged.status()).toBe(200);
  expect((await unchanged.json()).data.topic_id).toBe(link.topic_id);
});
