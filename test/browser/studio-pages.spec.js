import { waitForStudioPaint } from '../helpers/studio-screenshot.mjs';
import { test, expect } from '@playwright/test';
import { seedStudioLayout, cleanupStudioLayout } from '../helpers/studio-layout-fixture.mjs';

const sizes = [[320, 812], [390, 844], [768, 1024], [820, 1180], [915, 840], [1024, 900], [1100, 900], [1101, 900], [1280, 900], [1680, 1050], [1920, 1080]];
const profiles = [...sizes.map(([width, height]) => ({ width, height, theme: 'light' })), ...[[390, 844], [915, 840], [1680, 1050]].map(([width, height]) => ({ width, height, theme: 'dark' }))];
let session, headers, fixture, role, user, file, flow, routes, originalTheme;
async function send(request, path, { method = 'GET', body } = {}) {
  const response = await request.fetch(path, { method, headers, ...(body === undefined ? {} : { data: body }) });
  expect(response.ok(), `${method} ${path}: ${await response.text()}`).toBe(true);
  return response.status() === 204 ? null : (await response.json()).data;
}
test.beforeAll(async ({ request }) => {
  test.setTimeout(180000);
  const response = await request.post('/auth/login', { data: { email: 'flows-admin@example.test', password: 'Browser-flow-fixture-123!' } });
  expect(response.status()).toBe(200); session = (await response.json()).data; headers = { authorization: 'Bearer ' + session.access_token };
  originalTheme = (await send(request, '/studio-settings')).theme;
  const suffix = crypto.randomUUID().replaceAll('-', '').slice(0, 8);
  fixture = await seedStudioLayout((path, options) => send(request, path, options), suffix, { tagCount: 48 });
  role = await send(request, '/roles', { method: 'POST', body: { name: 'Visual role ' + suffix } });
  user = await send(request, '/users', { method: 'POST', body: { email: `visual-${suffix}@example.test`, password: 'Native-visual-fixture-123!', role: role.id } });
  const uploaded = await request.post('/files', { headers: { ...headers, 'content-type': 'application/octet-stream', 'x-filename': 'native-visual.svg', 'x-mimetype': 'image/svg+xml' }, data: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="640" height="400"><rect width="640" height="400" fill="#2563eb"/><text x="60" y="210" fill="white">Native Studio acceptance</text></svg>') });
  expect(uploaded.status()).toBe(201); file = (await uploaded.json()).data;
  flow = await send(request, '/flows', { method: 'POST', body: { name: 'Native visual graph with a long descriptive title', status: 'inactive', trigger: 'manual', accountability: 'trigger', options: { response: '$last' }, entry: 'result', operations: [{ id: 'result', key: 'result', name: 'Return native JSON', type: 'transform', position: { x: 420, y: 140 }, options: { value: { ready: true } }, resolve: null, reject: null }] } });
  const tag = (await send(request, `/items/${fixture.tags}?limit=1`))[0];
  const link = (await send(request, `/items/${fixture.junction}?limit=1`))[0];
  routes = [];
  for (const [collection, record] of [[fixture.parent, fixture.article], [fixture.child, fixture.translations[0]], [fixture.tags, tag], [fixture.junction, link]]) {
    routes.push([`list-${collection}`, `/content/${collection}`, '.table-panel[aria-busy="false"] .content-row-open, .table-panel[aria-busy="false"] .mobile-record-card']);
    for (const [kind, end] of [['new', 'new'], ['edit', record.id]]) routes.push([`${kind}-${collection}`, `/content/${collection}/${end}`, '.record-editor[aria-busy="false"] .form-actions button.primary-button:not(:disabled)']);
  }
  routes.push(
    ['model', '/data-model', '.navigation-tree'], ['schema-graph', '/data-model/~graph', '.schema-graph-canvas'], ['new-collection', '/data-model/new', '.data-model-create-form'],
    ['collection-overview', `/data-model/${fixture.parent}/overview`, '.collection-overview-panel'], ['fields', `/data-model/${fixture.parent}/fields`, '.data-model-detail-panel'],
    ['new-field', `/data-model/${fixture.parent}/fields/new`, '.field-builder'], ['field-detail', `/data-model/${fixture.parent}/fields/title`, '.field-detail-grid'],
    ['relations', `/data-model/${fixture.parent}/relations`, '.data-model-detail-panel'],
    ...['m2o', 'o2o', 'm2m'].map(type => [`relation-${type}`, `/data-model/${fixture.parent}/relations/new/${type}`, '.data-model-detail-panel select']),
    ['users', '/users', '.mobile-user-card, tbody tr:has(.table-row-actions)'], ['new-user', '/users/new', '.create-user-panel input'], ['user-detail', `/users/${user.id}`, '.user-detail-page'],
    ['roles', '/roles', '.role-list-button'], ['new-role', '/roles/new', 'main input'], ['role-detail', `/roles/${role.id}`, '.role-summary-panel'], ['permission-detail', `/roles/${role.id}/permissions/${fixture.parent}/read`, '.permission-detail-page'],
    ['files', '/files', '.file-card img'], ['upload', '/files/new', '.file-dropzone'], ['file-detail', `/files/${file.id}`, '.file-detail-page img'],
    ['ai', '/ai', '.ai-workspace textarea'], ['security', '/security', 'main input[type="password"]'], ['mcp', '/mcp', 'main input'], ['appearance', '/appearance', 'main input'],
    ['flows', '/flows', 'tbody tr, .flow-mobile-list article'], ['new-flow', '/flows/new', '.flow-canvas'], ['saved-flow', `/flows/${flow.id}`, '.flow-canvas']
  );
});
test.afterAll(async ({ request }) => {
  if (flow) await send(request, `/flows/${flow.id}?revision=${flow.revision}`, { method: 'DELETE' });
  if (file) await send(request, '/files/' + file.id, { method: 'DELETE' });
  if (user) await send(request, '/users/' + user.id, { method: 'DELETE' });
  if (role) await send(request, '/roles/' + role.id, { method: 'DELETE' });
  if (fixture) await cleanupStudioLayout((path, options) => send(request, path, options), fixture);
  if (originalTheme) await send(request, '/studio-settings', { method: 'PATCH', body: { theme: originalTheme } });
});

for (const { width, height, theme } of profiles) test(`every Studio page renders native data at ${width} × ${height} in ${theme} appearance without hidden layout overflow`, async ({ page, request }, info) => {
  test.setTimeout(240000);
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await send(request, '/studio-settings', { method: 'PATCH', body: { theme } });
  await page.setViewportSize({ width, height });
  await page.addInitScript(value => { sessionStorage.setItem('yuncms.studio.session', JSON.stringify(value)); localStorage.setItem('yuncms.studio.locale', 'en'); }, session);
  for (const [name, path, selector] of routes) {
    await test.step(name, async () => {
      await page.goto('/#' + path);
      await expect(page.locator(selector).filter({ visible: true }).first()).toBeVisible();
      if (path.startsWith(`/data-model/${fixture.parent}/`)) await expect(page.locator('.data-model-detail-actions .schema-count')).toHaveText('5 fields');
      await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
      await expect(page.locator('main .error-banner')).toHaveCount(0);
      await waitForStudioPaint(page, name);
      if (width <= 1100) {
        await expect(page.getByRole('button', { name: 'Open menu', exact: true })).toBeInViewport();
        await expect(page.locator('.sidebar-brand-row .studio-brand-logo')).toBeInViewport();
      }
      const overflow = await page.locator('main .panel, main .nested-relation-panel, main .nested-language-tabs, main .nested-language-card, main .nested-m2m-grid, main .flow-inspector').evaluateAll(elements => elements.flatMap(element => {
        const r = element.getBoundingClientRect(); return r.width && r.height && (r.left < -1 || r.right > innerWidth + 1) ? [{ className: element.className, left: r.left, right: r.right }] : [];
      }));
      expect(overflow, name).toEqual([]);
      const oversizedChoices = await page.locator('.relation-picker-trigger').evaluateAll(elements => elements.filter(element => element.getBoundingClientRect().height > 64).map(element => ({ text: element.textContent, height: element.getBoundingClientRect().height })));
      expect(oversizedChoices, name).toEqual([]);
      expect(await page.locator('.nested-m2m-option').evaluateAll(elements => elements.filter(element => element.getBoundingClientRect().height > 74).length), name).toBe(0);
      for (const picker of await page.locator('.relation-picker-trigger[title]').all()) await expect(picker).toHaveAttribute('title', (await picker.locator('span').first().textContent()).trim());
      expect(await page.evaluate(() => document.documentElement.scrollWidth), name).toBeLessThanOrEqual(width + 1);
      // Native screenshots are retained for human review; geometry assertions do
      // not substitute for the visual review of these artifacts.
      await page.screenshot({ path: info.outputPath(`${name}-viewport.png`), animations: 'disabled' });
      await page.screenshot({ path: info.outputPath(`${name}-full.png`), fullPage: true, animations: 'disabled' });
    });
  }
  expect(errors).toEqual([]);
});
