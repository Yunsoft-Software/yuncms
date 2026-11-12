import { test, expect } from '@playwright/test';

const collection = 'browser_flow_records';
const recordRow = (page, id) => page.locator('tbody tr').filter({ has: page.getByRole('checkbox', { name: `Select record ${id}`, exact: true }) });
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
    const allowedRow = recordRow(page, allowed.id), lockedRow = recordRow(page, locked.id);
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
    const row = recordRow(page, item.id); await expect(row).toBeVisible();
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
    await page.reload();
    const table = page.locator('section.table-panel');
    await expect(table).toHaveAttribute('aria-busy', 'false');
    await expect(recordRow(page, bulk[0].id)).toBeVisible();
    // Search is debounced and the resulting native list refresh clears selection.
    // Wait for that real request and its capability refresh before selecting rows.
    const searched = page.waitForResponse(response => {
      const url = new URL(response.url());
      return url.pathname === `/items/${collection}` && (url.searchParams.get('filter') ?? '').includes(JSON.stringify(key)) && response.request().method() === 'GET';
    }, { timeout: 15000 });
    await page.getByRole('searchbox', { name: 'Search', exact: true }).fill(key);
    expect((await searched).status()).toBe(200);
    await expect(table).toHaveAttribute('aria-busy', 'false');
    for (const record of bulk) await recordRow(page, record.id).locator('input[type="checkbox"]').check();
    await page.getByRole('button', { name: 'Delete selected', exact: true }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Delete selected', exact: true }).click();
    for (const record of bulk) await expect(recordRow(page, record.id)).toHaveCount(0);
  } finally {
    for (const record of records) expect([204, 404]).toContain((await request.delete(`/items/${collection}/${record.id}`, { headers })).status());
  }
});

test('opening the inspector preserves immediate field focus and typed values across repeated native saves', async ({ page, request }) => {
  const actor = await session(request, 'content-writer@example.test'), headers = { authorization: `Bearer ${actor.access_token}` };
  const title = `Rapid inspector focus ${crypto.randomUUID()}`, record = await create(request, headers, title);
  try {
    await open(page, request, 'content-writer@example.test'); await page.getByRole('searchbox', { name: 'Search', exact: true }).fill(title);
    const row = recordRow(page, record.id);
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
    const row = recordRow(page, record.id); await row.getByRole('button', { name: 'Quick edit', exact: true }).click();
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

test('issue 122: Studio saves M2O relational permission filters and enforces parent-scoped Public reads and row capabilities', async ({ browser, page, request }) => {
  const admin = await session(request, 'flows-admin@example.test');
  const adminHeaders = { authorization: `Bearer ${admin.access_token}` };
  const suffix = crypto.randomUUID().replaceAll('-', '').slice(0, 8);
  const parentCollection = `m2o_art_${suffix}`;
  const childCollection = `m2o_tr_${suffix}`;
  let staffRole = null;
  let staffUser = null;
  let pubPerm = null;
  let staffContext = null;

  try {
    expect((await request.post('/schema/collections', { headers: adminHeaders, data: { collection: parentCollection } })).status()).toBe(201);
    expect((await request.post(`/schema/collections/${parentCollection}/fields`, {
      headers: adminHeaders,
      data: { field: 'status', type: 'string', required: true },
    })).status()).toBe(201);

    expect((await request.post('/schema/collections', { headers: adminHeaders, data: { collection: childCollection } })).status()).toBe(201);
    for (const field of [
      { field: 'articles_id', type: 'uuid', required: false },
      { field: 'slug', type: 'string', required: true },
      { field: 'title', type: 'string', required: true },
    ]) {
      expect((await request.post(`/schema/collections/${childCollection}/fields`, { headers: adminHeaders, data: field })).status()).toBe(201);
    }

    expect((await request.post('/schema/relations/m2o', {
      headers: adminHeaders,
      data: { manyCollection: childCollection, manyField: 'articles_id', oneCollection: parentCollection, onDelete: 'SET NULL' },
    })).status()).toBe(201);

    const pubArticle = (await (await request.post(`/items/${parentCollection}`, { headers: adminHeaders, data: { status: 'published' } })).json()).data;
    const draftArticle = (await (await request.post(`/items/${parentCollection}`, { headers: adminHeaders, data: { status: 'draft' } })).json()).data;
    const pubTr = (await (await request.post(`/items/${childCollection}`, {
      headers: adminHeaders,
      data: { articles_id: pubArticle.id, slug: 'pub-tr', title: 'Published child row' },
    })).json()).data;
    const draftTr = (await (await request.post(`/items/${childCollection}`, {
      headers: adminHeaders,
      data: { articles_id: draftArticle.id, slug: 'draft-tr', title: 'Draft child row' },
    })).json()).data;

    const rolesRes = await request.get('/roles', { headers: adminHeaders });
    const publicRole = (await rolesRes.json()).data.find((entry) => entry.public);
    expect(publicRole).toBeTruthy();

    const createdPubPermRes = await request.post('/permissions', {
      headers: adminHeaders,
      data: { role: publicRole.id, collection: childCollection, action: 'read', fields: ['id', 'articles_id', 'slug', 'title'] },
    });
    expect(createdPubPermRes.status()).toBe(201);
    pubPerm = (await createdPubPermRes.json()).data;

    // Configure the M2O relational filter through Studio's real Roles & Permissions Advanced JSON editor.
    await open(page, request, 'flows-admin@example.test', `/#/roles/${publicRole.id}/permissions/${childCollection}/read`);
    const rowFilterCard = page.locator('#advanced-permission-form .permission-rule-builder-card').first();
    await expect(rowFilterCard).toBeVisible();
    await rowFilterCard.getByRole('button', { name: 'Advanced JSON', exact: true }).click();
    const rawTextarea = rowFilterCard.getByLabel('Advanced JSON', { exact: true });
    await rawTextarea.fill(JSON.stringify({ articles_id: { status: { _eq: 'published' } } }, null, 2));
    const savingPatch = page.waitForResponse(
      (response) => response.url().endsWith(`/permissions/${pubPerm.id}`) && response.request().method() === 'PATCH',
    );
    await page.getByRole('button', { name: 'Save rules', exact: true }).click();
    expect((await savingPatch).status()).toBe(200);
    await expect(page.locator('.notice-banner')).toBeVisible();
    await expect(rowFilterCard.locator('.rule-builder-raw-notice')).toBeVisible();

    // Anonymous Public reads only see the published parent's child row; draft child row returns 404.
    const anonListRes = await request.get(`/items/${childCollection}`, { headers: {} });
    expect(anonListRes.status()).toBe(200);
    expect((await anonListRes.json()).data.map((row) => row.id)).toEqual([pubTr.id]);
    expect((await request.get(`/items/${childCollection}/${pubTr.id}`, { headers: {} })).status()).toBe(200);
    expect((await request.get(`/items/${childCollection}/${draftTr.id}`, { headers: {} })).status()).toBe(404);

    // Scoped staff role with unrestricted read and relational update/delete filters hides Edit/Delete on draft child rows in Studio.
    staffRole = (await (await request.post('/roles', {
      headers: adminHeaders,
      data: { name: `M2O Staff ${suffix}` },
    })).json()).data;
    await request.post('/permissions', {
      headers: adminHeaders,
      data: { role: staffRole.id, collection: childCollection, action: 'read' },
    });
    for (const action of ['update', 'delete']) {
      await request.post('/permissions', {
        headers: adminHeaders,
        data: {
          role: staffRole.id,
          collection: childCollection,
          action,
          filter: { articles_id: { status: { _eq: 'published' } } },
        },
      });
    }
    const staffEmail = `m2o-staff-${suffix}@example.test`;
    staffUser = (await (await request.post('/users', {
      headers: adminHeaders,
      data: { email: staffEmail, password: 'Browser-flow-fixture-123!', role: staffRole.id, status: 'active' },
    })).json()).data;

    staffContext = await browser.newContext({ baseURL: new URL(page.url()).origin });
    const staffPage = await staffContext.newPage();
    const staffHeaders = await open(staffPage, request, staffEmail, `/#/content/${childCollection}`);
    const pubRow = recordRow(staffPage, pubTr.id);
    const draftRow = recordRow(staffPage, draftTr.id);
    await expect(pubRow).toBeVisible();
    await expect(draftRow).toBeVisible();
    await expect(pubRow.getByRole('button', { name: 'Edit', exact: true })).toBeVisible();
    await expect(pubRow.getByRole('button', { name: 'Delete', exact: true })).toBeVisible();
    await expect(draftRow.getByRole('button', { name: 'Edit', exact: true })).toHaveCount(0);
    await expect(draftRow.getByRole('button', { name: 'Delete', exact: true })).toHaveCount(0);
    expect((await request.patch(`/items/${childCollection}/${draftTr.id}`, {
      headers: staffHeaders,
      data: { title: 'Blocked draft edit' },
    })).status()).toBe(404);
    expect((await request.delete(`/items/${childCollection}/${draftTr.id}`, {
      headers: staffHeaders,
    })).status()).toBe(404);
    expect((await request.patch(`/items/${childCollection}/${pubTr.id}`, {
      headers: staffHeaders,
      data: { title: 'Allowed published edit' },
    })).status()).toBe(200);
  } finally {
    if (staffContext) await staffContext.close();
    if (pubPerm) await request.delete(`/permissions/${pubPerm.id}`, { headers: adminHeaders });
    if (staffUser) await request.delete(`/users/${staffUser.id}`, { headers: adminHeaders });
    if (staffRole) {
      const perms = (await (await request.get('/permissions', { headers: adminHeaders })).json()).data ?? [];
      for (const perm of perms.filter((entry) => entry.role === staffRole.id)) {
        await request.delete(`/permissions/${perm.id}`, { headers: adminHeaders });
      }
      await request.delete(`/roles/${staffRole.id}`, { headers: adminHeaders });
    }
    await request.delete(`/schema/relations/m2o/${childCollection}/articles_id`, { headers: adminHeaders });
    await request.delete(`/schema/collections/${childCollection}?destructive=true`, { headers: adminHeaders });
    await request.delete(`/schema/collections/${parentCollection}?destructive=true`, { headers: adminHeaders });
  }
});

test('issue 124: Studio routed permission editor preserves toggle and rule save notices across index reloads', async ({ page, request }) => {
  const admin = await session(request, 'flows-admin@example.test');
  const adminHeaders = { authorization: `Bearer ${admin.access_token}` };
  const suffix = crypto.randomUUID().replaceAll('-', '').slice(0, 8);
  let role = null;

  try {
    const roleRes = await request.post('/roles', {
      headers: adminHeaders,
      data: { name: `Notice Guard ${suffix}` },
    });
    expect(roleRes.status()).toBe(201);
    role = (await roleRes.json()).data;

    await open(page, request, 'flows-admin@example.test', `/#/roles/${role.id}/permissions/${collection}/read`);
    const masterCheckbox = page.locator('.permission-master-switch input[type="checkbox"]');
    await expect(masterCheckbox).not.toBeChecked();

    const createdPermRes = page.waitForResponse(
      (response) => response.url().endsWith('/permissions') && response.request().method() === 'POST',
    );
    const reloadedFieldsAfterToggle = page.waitForResponse(
      (response) => response.url().endsWith(`/schema/collections/${collection}/fields`) && response.request().method() === 'GET',
    );
    await page.locator('.permission-master-switch .permission-toggle').click();
    const createdPerm = (await (await createdPermRes).json()).data;
    await reloadedFieldsAfterToggle;
    await expect(masterCheckbox).toBeChecked();
    await expect(page.locator('.notice-banner')).toHaveText(`Read access granted for ${collection}`);
    await expect(page.locator('#advanced-permission-form')).toBeVisible();

    await page.getByLabel('Allow all fields', { exact: true }).uncheck();
    await page.locator('.field-choice').filter({ hasText: 'title · string' }).locator('input[type="checkbox"]').check();

    const savedPermRes = page.waitForResponse(
      (response) => response.url().endsWith(`/permissions/${createdPerm.id}`) && response.request().method() === 'PATCH',
    );
    const reloadedFieldsAfterSave = page.waitForResponse(
      (response) => response.url().endsWith(`/schema/collections/${collection}/fields`) && response.request().method() === 'GET',
    );
    await page.getByRole('button', { name: 'Save rules', exact: true }).click();
    expect((await savedPermRes).status()).toBe(200);
    await reloadedFieldsAfterSave;
    await expect(page.locator('.notice-banner')).toHaveText('Advanced permission rules saved');

    const storedPerms = (await (await request.get('/permissions', { headers: adminHeaders })).json()).data ?? [];
    const storedReadPerm = storedPerms.find((entry) => entry.id === createdPerm.id);
    expect(storedReadPerm?.fields).toEqual(['title']);

    await page.goto(`/#/roles/${role.id}/permissions/${collection}/update`);
    await expect(page.locator('.permission-detail-heading h2')).toContainText('Update');
    await expect(page.locator('.notice-banner')).toHaveCount(0);
  } finally {
    if (role) {
      const perms = (await (await request.get('/permissions', { headers: adminHeaders })).json()).data ?? [];
      for (const perm of perms.filter((entry) => entry.role === role.id)) {
        await request.delete(`/permissions/${perm.id}`, { headers: adminHeaders });
      }
      await request.delete(`/roles/${role.id}`, { headers: adminHeaders });
    }
  }
});
