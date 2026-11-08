import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { FIELD_TYPE_OPTIONS } from '../../apps/studio/src/field-ui.js';
import { createDatabasePool, loadConfig, quoteIdentifier, withAdvisoryLock } from '@yunsoft/yuncms-core';

let session, headers;
const password = 'Browser-workflow-fixture-123!';
test.use({ actionTimeout: 15000 });
test.beforeAll(async ({ request }) => {
  const response = await request.post('/auth/login', { data: { email: 'flows-admin@example.test', password: 'Browser-flow-fixture-123!' } });
  expect(response.status()).toBe(200); session = (await response.json()).data;
  headers = { authorization: `Bearer ${session.access_token}` };
});
async function open(page, path) {
  await page.addInitScript(value => { sessionStorage.setItem('yuncms.studio.session', JSON.stringify(value)); localStorage.setItem('yuncms.studio.locale', 'en'); }, session);
  await page.goto('/#' + path);
}
async function confirm(page) { const dialog = page.getByRole('dialog'); await expect(dialog).toBeVisible(); await dialog.locator('.danger-button').click(); }
async function mutation(page, path, method, action) {
  const pending = page.waitForResponse(response => new URL(response.url()).pathname === path && response.request().method() === method, { timeout: 15000 });
  const [response] = await Promise.all([pending, action()]);
  expect(response.ok(), `${method} ${path}: HTTP ${response.status()}`).toBe(true);
  return response.status() === 204 ? null : (await response.json()).data;
}

test('native file upload, preview, metadata editing, download and confirmed deletion preserve the actual bytes', async ({ page, request }, info) => {
  const name = `workflow-${crypto.randomUUID()}.svg`;
  const bytes = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="480" height="300"><rect width="480" height="300" fill="#2563eb"/><text x="30" y="160" fill="white">Native file acceptance</text></svg>');
  let file;
  try {
    await open(page, '/files/new');
    await page.locator('input[type=file]').setInputFiles({ name, mimeType: 'image/svg+xml', buffer: bytes });
    await expect(page.locator('.upload-queue')).toBeVisible();
    file = await mutation(page, '/files', 'POST', () => page.locator('.file-dropzone button[type=submit]').click());
    await expect(page).toHaveURL(/#\/files$/);
    await page.goto('/#/files/' + file.id);
    const detail = page.locator('.file-detail-page'); await expect(detail).toBeVisible();
    await expect(detail.locator('img')).toBeVisible();
    await detail.getByRole('button', { name: 'Edit', exact: true }).click();
    const title = 'A very long accessible media title — '.repeat(5).trim();
    await page.locator('.file-detail-editor').getByLabel('Title', { exact: true }).fill(title);
    await page.locator('.file-detail-editor').getByLabel('Download filename', { exact: true }).fill('native-edited.svg');
    await mutation(page, '/files/' + file.id, 'PATCH', () => page.getByRole('button', { name: 'Save changes', exact: true }).click());
    await page.reload(); await expect(detail.locator('h2')).toHaveText(title);
    const downloading = page.waitForEvent('download'); await detail.getByRole('button', { name: 'Download', exact: true }).click();
    const downloaded = await downloading; expect(downloaded.suggestedFilename()).toBe('native-edited.svg');
    expect(await readFile(await downloaded.path())).toEqual(bytes);
    for (const width of [320, 390, 820, 1100, 1680]) {
      await page.setViewportSize({ width, height: 900 });
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
      await page.screenshot({ path: info.outputPath(`file-${width}.png`), fullPage: true });
    }
    await detail.getByRole('button', { name: 'Delete', exact: true }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Cancel', exact: true }).click();
    expect((await request.get('/files/' + file.id, { headers })).status()).toBe(200);
    await detail.getByRole('button', { name: 'Delete', exact: true }).click();
    await mutation(page, '/files/' + file.id, 'DELETE', () => confirm(page));
    expect((await request.get('/files/' + file.id, { headers })).status()).toBe(404); file = null;
  } finally { if (file) await request.delete('/files/' + file.id, { headers }); }
});

test('role and user management persist native permissions, status changes, session revocation and confirmed removal', async ({ page, request }) => {
  let role, user, counterCreated = false;
  const suffix = crypto.randomUUID(), email = `workflow-${suffix}@example.test`;
  const counterField = 'browser_counter_' + suffix.replaceAll('-', '').slice(0, 8);
  try {
    await open(page, '/roles/new');
    await page.getByLabel('Name', { exact: true }).fill('Native workflow ' + suffix);
    role = await mutation(page, '/roles', 'POST', () => page.getByRole('button', { name: 'Create role', exact: true }).click());
    await expect(page).toHaveURL(new RegExp(`#/roles/${role.id}$`));
    await page.getByLabel('Role name', { exact: true }).fill('Renamed workflow ' + suffix);
    await mutation(page, '/roles/' + role.id, 'PATCH', () => page.getByRole('button', { name: 'Save name', exact: true }).click());
    await page.reload(); await expect(page.getByLabel('Role name', { exact: true })).toHaveValue('Renamed workflow ' + suffix);
    expect((await request.post('/schema/system-collections/yuncms_users/fields', { headers, data: { field: counterField, name: 'External counter', type: 'bigint' } })).status()).toBe(201); counterCreated = true;
    await page.goto('/#/users/new');
    await page.getByRole('combobox', { name: 'Role', exact: true }).selectOption(role.id);
    const emailField = page.getByLabel('Email', { exact: true });
    await emailField.click();
    await emailField.pressSequentially(email);
    await page.getByLabel('Password', { exact: true }).fill(password);
    await expect(emailField).toHaveValue(email);
    user = await mutation(page, '/users', 'POST', () => page.getByRole('button', { name: 'Create user', exact: true }).click());
    await expect(page.locator('.user-detail-page')).toBeVisible();
    await page.getByRole('spinbutton', { name: /^External counter/ }).fill('9007199254740993');
    await mutation(page, '/users/' + user.id, 'PATCH', () => page.locator('.user-detail-form').getByRole('button', { name: 'Save', exact: true }).click());
    const counter = await request.get('/users/' + user.id, { headers }); expect((await counter.json()).data[counterField]).toBe('9007199254740993');
    await page.reload(); await expect(page.getByRole('spinbutton', { name: /^External counter/ })).toHaveValue('9007199254740993');
    const login = await request.post('/auth/login', { data: { email, password } }); expect(login.status()).toBe(200);
    const userHeaders = { authorization: 'Bearer ' + (await login.json()).data.access_token };
    expect((await request.get('/schema/collections', { headers: userHeaders })).status()).toBe(403);
    await mutation(page, '/users/' + user.id, 'PATCH', () => page.getByRole('combobox', { name: 'Status', exact: true }).selectOption('suspended'));
    expect((await request.get('/users/me', { headers: userHeaders })).status()).toBe(401);
    await page.reload(); await expect(page.getByRole('combobox', { name: 'Status', exact: true })).toHaveValue('suspended');
    await mutation(page, '/users/' + user.id, 'PATCH', () => page.getByRole('combobox', { name: 'Status', exact: true }).selectOption('active'));
    await page.getByRole('button', { name: 'Delete', exact: true }).click();
    await mutation(page, '/users/' + user.id, 'DELETE', () => confirm(page)); user = null;
    await expect(page).toHaveURL(/#\/users$/);
    await page.goto('/#/roles/' + role.id);
    await page.getByRole('button', { name: 'Delete role', exact: true }).click();
    await mutation(page, '/roles/' + role.id, 'DELETE', () => confirm(page)); role = null;
  } finally {
    if (user) await request.delete('/users/' + user.id, { headers });
    if (role) await request.delete('/roles/' + role.id, { headers });
    if (counterCreated) {
      // System fields are additive through the public API. Remove only this
      // test-owned optional column directly from the guarded disposable DB.
      const config = loadConfig(process.env); expect(config.database.database).toMatch(/test|ci|dev/i);
      expect(process.env.YUNCMS_TEST_DB_ALLOW_DESTRUCTIVE).toBe('1');
      expect(counterField).toMatch(/^browser_counter_[a-f0-9]{8}$/);
      const pool = createDatabasePool(config.database);
      try {
        await withAdvisoryLock(pool, 'yuncms:schema', async connection => {
          await connection.query(`ALTER TABLE yuncms_users DROP COLUMN ${quoteIdentifier(counterField)}`);
          await connection.query('DELETE FROM yuncms_fields WHERE collection = ? AND field = ?', ['yuncms_users', counterField]);
          await connection.query('UPDATE yuncms_schema_state SET version = version + 1 WHERE id = 1');
        });
      } finally { await pool.end(); }
    }
  }
});

test('Studio creates every supported field type through native schema writes and reloads their actual definitions', async ({ page, request }, info) => {
  test.setTimeout(240000);
  const collection = 'browser_types_' + crypto.randomUUID().replaceAll('-', '').slice(0, 10);
  let mediaFile, permissionRole, permissionUser;
  try {
    await open(page, '/data-model/new');
    await page.locator('.data-model-create-form input').first().fill(collection);
    await mutation(page, '/schema/collections', 'POST', () => page.getByRole('button', { name: 'Create collection', exact: true }).click());
    await expect(page).toHaveURL(new RegExp(`#/data-model/${collection}/overview$`));
    for (const option of FIELD_TYPE_OPTIONS) {
      await page.goto(`/#/data-model/${collection}/fields/new`);
      const form = page.locator('.field-builder'); await expect(form).toBeVisible();
      // Select the same shared native control at phone/tablet widths and type cards on desktop.
      await page.setViewportSize({ width: 820, height: 1180 });
      await form.locator('.mobile-field-type-select select').selectOption(option.value);
      await form.locator('.field-key-input input').fill('Native ' + option.value);
      await form.locator('.field-machine-key-input input').fill('value_' + option.value);
      await mutation(page, `/schema/collections/${collection}/fields`, 'POST', () => form.locator('button[type=submit]').click());
      await expect(page).toHaveURL(new RegExp(`#/data-model/${collection}/fields/value_${option.value}$`));
      const response = await request.get(`/schema/collections/${collection}/fields/value_${option.value}`, { headers });
      expect(response.status()).toBe(200); const field = (await response.json()).data;
      expect(field.field).toBe('value_' + option.value);
      expect(field.type).toBe(['image', 'file'].includes(option.value) ? 'uuid' : option.value === 'richtext' ? 'text' : option.value);
      if (option.value === 'richtext') expect(field.interface).toBe('richtext');
      if (['image', 'file'].includes(option.value)) expect(field.interface).toBe(option.value);
      await page.goto(`/#/data-model/${collection}/fields/value_${option.value}`);
      await expect(page.locator('.field-detail-grid')).toContainText('value_' + option.value);
      await page.screenshot({ path: info.outputPath('field-' + option.value + '.png'), fullPage: true });
    }
    await page.goto(`/#/content/${collection}/new`);
    const editor = page.locator('.record-editor');
    await expect(editor).toBeVisible();
    await expect(page.locator('main .error-banner')).toHaveCount(0);
    for (const [field, value] of Object.entries({ string: 'Native Unicode — Türkçe العربية 日本語', text: 'First line\nSecond line', integer: '42', decimal: '1234.56', bigint: '9007199254740993', uuid: '11111111-1111-4111-8111-111111111111', date: '2026-11-04', datetime: '2026-11-04T12:30', timestamp: '2026-11-04T12:30' })) {
      await editor.locator(`[data-field="value_${field}"] input, [data-field="value_${field}"] textarea`).fill(value);
    }
    await editor.locator('[data-field="value_boolean"] input').check();
    await editor.locator('[data-field="value_json"] textarea').fill('{"native":true,"list":[1,"Türkçe"]}');
    await editor.locator('[data-field="value_richtext"] [contenteditable=true]').fill('Native rich text');
    mediaFile = await mutation(page, '/files', 'POST', () => editor.locator('[data-field="value_image"] input[type=file]').setInputFiles({ name: collection + '.svg', mimeType: 'image/svg+xml', buffer: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><rect width="64" height="64" fill="#2563eb"/></svg>') }));
    await expect(editor.locator('[data-field="value_image"] select')).toHaveValue(mediaFile.id);
    await editor.locator('[data-field="value_file"] select').selectOption(mediaFile.id);
    const record = await mutation(page, `/items/${collection}`, 'POST', () => editor.locator('.form-actions button[type=submit]').click());
    const readback = await request.get(`/items/${collection}/${record.id}`, { headers }); expect(readback.status()).toBe(200);
    const saved = (await readback.json()).data;
    expect(saved).toMatchObject({ value_string: 'Native Unicode — Türkçe العربية 日本語', value_text: 'First line\nSecond line', value_integer: 42, value_date: '2026-11-04', value_uuid: '11111111-1111-4111-8111-111111111111', value_image: mediaFile.id, value_file: mediaFile.id });
    expect(String(saved.value_bigint)).toBe('9007199254740993');
    expect(Number(saved.value_decimal)).toBe(1234.56); expect([true, 1]).toContain(saved.value_boolean);
    expect(typeof saved.value_json === 'string' ? JSON.parse(saved.value_json) : saved.value_json).toEqual({ native: true, list: [1, 'Türkçe'] });
    expect(saved.value_richtext).toContain('Native rich text');
    await expect(page).toHaveURL(new RegExp(`#/content/${collection}$`));
    await page.goto(`/#/content/${collection}/${record.id}`);
    await expect(editor.locator('[data-field="value_bigint"] input')).toHaveValue('9007199254740993');
    await expect(editor.locator('[data-field="value_date"] input')).toHaveValue('2026-11-04');
    for (const field of ['datetime', 'timestamp']) await expect(editor.locator(`[data-field="value_${field}"] input`)).toHaveValue(/2026-11-04T12:30/);
    for (const field of ['file', 'image']) {
      const control = editor.locator(`[data-field="value_${field}"]`);
      await expect(control.locator('select')).toHaveValue(mediaFile.id);
      await expect(control.locator('.file-field-preview-card img')).toBeVisible();
      await control.locator('.file-field-preview-copy button').click();
      await expect(control.locator('select')).toHaveValue('');
      await control.locator('select').selectOption(mediaFile.id);
    }
    await page.screenshot({ path: info.outputPath('all-fields-editor.png'), fullPage: true });
    await page.goto(`/#/content/${collection}`);
    await expect(page.locator('.table-panel')).toHaveAttribute('aria-busy', 'false');
    await page.locator('.mobile-filter-toggle').click();
    const filters = page.locator('.filter-builder');
    await filters.locator('.filter-field-control select').selectOption('value_bigint');
    await filters.locator('.filter-operator-control select').selectOption('_eq');
    await filters.locator('.filter-value-control input').fill('9007199254740993');
    const filtering = page.waitForResponse(response => {
      const url = new URL(response.url());
      return url.pathname === `/items/${collection}` && response.request().method() === 'GET' && url.searchParams.get('filter')?.includes('value_bigint');
    });
    await filters.getByRole('button', { name: 'Add filter', exact: true }).click();
    const filtered = await filtering; expect(filtered.status()).toBe(200);
    expect(new URL(filtered.url()).searchParams.get('filter')).toContain('"9007199254740993"');
    expect((await filtered.json()).data.map(row => row.id)).toEqual([record.id]);

    // Configure an actual role through Studio and verify that its BIGINT row
    // filter admits only the exact native record, never an adjacent integer.
    const adjacent = await request.post(`/items/${collection}`, { headers, data: { value_string: 'Adjacent integer', value_bigint: '9007199254740992' } }); expect(adjacent.status()).toBe(201);
    const adjacentId = (await adjacent.json()).data.id;
    const roleResponse = await request.post('/roles', { headers, data: { name: collection + ' reader' } }); expect(roleResponse.status()).toBe(201); permissionRole = (await roleResponse.json()).data;
    const email = collection + '@example.test';
    const userResponse = await request.post('/users', { headers, data: { email, password, role: permissionRole.id } }); expect(userResponse.status()).toBe(201); permissionUser = (await userResponse.json()).data;
    await page.goto(`/#/roles/${permissionRole.id}/permissions/${collection}/read`);
    const permissionToggle = page.locator('.permission-master-switch input[type=checkbox]');
    const permission = await mutation(page, '/permissions', 'POST', () => permissionToggle.click());
    await expect(permissionToggle).toBeChecked();
    await page.getByRole('checkbox', { name: 'Allow all fields', exact: true }).uncheck();
    for (const field of ['id · uuid', 'value_bigint · bigint', 'value_string · string']) await page.locator('.field-choice').filter({ has: page.getByText(field, { exact: true }) }).getByRole('checkbox').check();
    const rowFilter = page.locator('.permission-rule-builder-card').first();
    await rowFilter.getByRole('button', { name: 'Add rule', exact: true }).click();
    await rowFilter.locator('.rule-builder-row select').first().selectOption('value_bigint');
    await rowFilter.locator('.rule-builder-row input').fill('9007199254740993');
    await expect(rowFilter.locator('.rule-builder-row input')).toHaveValue('9007199254740993');
    await mutation(page, '/permissions/' + permission.id, 'PATCH', () => page.getByRole('button', { name: 'Save rules', exact: true }).click());
    await page.reload(); await expect(rowFilter.locator('.rule-builder-row input')).toHaveValue('9007199254740993');
    const login = await request.post('/auth/login', { data: { email, password } }); expect(login.status()).toBe(200);
    const actor = { authorization: 'Bearer ' + (await login.json()).data.access_token };
    const allowed = await request.get(`/items/${collection}`, { headers: actor }); expect(allowed.status()).toBe(200);
    const rows = (await allowed.json()).data; expect(rows.map(row => row.id)).toEqual([record.id]); expect(rows[0].value_bigint).toBe('9007199254740993');
    expect(rows[0]).not.toHaveProperty('value_text');
    expect((await request.get(`/items/${collection}/${adjacentId}`, { headers: actor })).status()).toBe(404);
    expect((await request.post(`/items/${collection}`, { headers: actor, data: { value_string: 'Denied' } })).status()).toBe(403);
  } finally {
    if (permissionUser) await request.delete('/users/' + permissionUser.id, { headers });
    if (permissionRole) await request.delete('/roles/' + permissionRole.id, { headers });
    await request.delete(`/schema/collections/${collection}?destructive=true`, { headers });
    if (mediaFile) await request.delete('/files/' + mediaFile.id, { headers });
  }
});
