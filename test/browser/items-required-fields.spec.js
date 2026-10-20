import { test, expect } from '@playwright/test';

const password = 'Browser-flow-fixture-123!';
async function login(request, email) {
  const response = await request.post('/auth/login', { data: { email, password } });
  expect(response.status()).toBe(200); return (await response.json()).data;
}

test('ordinary Studio writers get safe required-null errors through actual browser HTTP and retain their record after reload', async ({ page, request }) => {
  const admin = await login(request, 'flows-admin@example.test'), adminHeaders = { authorization: `Bearer ${admin.access_token}` };
  const collection = 'browser_required_' + crypto.randomUUID().slice(0, 8), permissionIds = [];
  const created = await request.post('/schema/collections', { headers: adminHeaders, data: { collection } });
  expect(created.status()).toBe(201);
  try {
    for (const [field, type] of [['title', 'string'], ['quantity', 'integer'], ['active', 'boolean']]) {
      const result = await request.post(`/schema/collections/${collection}/fields`, { headers: adminHeaders, data: { field, type, required: true } });
      expect(result.status()).toBe(201);
    }
    const roles = (await (await request.get('/roles', { headers: adminHeaders })).json()).data;
    const writerRole = roles.find(role => role.name === 'Browser content writer'); expect(writerRole).toBeTruthy();
    const fields = ['id', 'title', 'quantity', 'active'];
    for (const action of ['read', 'create', 'update']) {
      const permission = await request.post('/permissions', { headers: adminHeaders, data: { role: writerRole.id, collection, action, fields } });
      expect(permission.status()).toBe(201); permissionIds.push((await permission.json()).data.id);
    }
    const writer = await login(request, 'content-writer@example.test');
    await page.addInitScript(session => {
      sessionStorage.setItem('yuncms.studio.session', JSON.stringify(session)); localStorage.setItem('yuncms.studio.locale', 'en');
    }, writer);
    await page.goto(`/#/content/${collection}`);
    const valid = { title: 'Required-field browser proof', quantity: 0, active: false };
    const result = await page.evaluate(async ({ collection, token, valid }) => {
      const headers = { authorization: `Bearer ${token}`, 'content-type': 'application/json' };
      const response = await fetch(`/items/${collection}`, { method: 'POST', headers, body: JSON.stringify(valid) });
      return { status: response.status, body: await response.json() };
    }, { collection, token: writer.access_token, valid });
    expect(result.status).toBe(201); const id = result.body.data.id;
    await page.reload(); await expect(page.locator('tbody tr').filter({ hasText: id })).toContainText(valid.title);
    for (const method of ['POST', 'PATCH']) for (const field of ['title', 'quantity', 'active']) {
      const response = await page.evaluate(async ({ collection, token, id, method, payload }) => {
        const result = await fetch(`/items/${collection}${method === 'PATCH' ? '/' + id : ''}`, {
          method, headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify(payload),
        });
        return { status: result.status, body: await result.json() };
      }, { collection, token: writer.access_token, id, method, payload: { ...(method === 'POST' ? valid : {}), [field]: null } });
      expect(response.status).toBe(400); expect(response.body.errors[0].code).toBe('REQUIRED_FIELD_MISSING');
      expect(response.body.errors[0].path).toBe(field); expect(JSON.stringify(response.body)).not.toMatch(/ER_BAD_NULL|INSERT INTO|UPDATE `|mysql/i);
    }
    // Items supports explicit Public-role grants; this ungranted collection
    // must retain its native permission denial before payload validation.
    const publicDenied = await request.post(`/items/${collection}`, { data: { ...valid, title: null } });
    expect(publicDenied.status()).toBe(403); expect((await publicDenied.json()).errors[0].code).toBe('FORBIDDEN');
    const reader = await login(request, 'content-reader@example.test');
    expect((await request.patch(`/items/${collection}/${id}`, { headers: { authorization: `Bearer ${reader.access_token}` }, data: { title: null } })).status()).toBe(403);
    const stored = await request.get(`/items/${collection}`, { headers: adminHeaders });
    expect(stored.status()).toBe(200); const rows = (await stored.json()).data;
    // Native MySQL boolean readback remains the existing TINYINT 0 contract.
    expect(rows).toHaveLength(1); expect(rows[0]).toMatchObject({ id, title: valid.title, quantity: 0, active: 0 });
    await page.reload(); await expect(page.locator('tbody tr')).toHaveCount(1);
    await expect(page.locator('tbody tr').filter({ hasText: id })).toContainText(valid.title);
  } finally {
    for (const id of permissionIds) expect((await request.delete(`/permissions/${id}`, { headers: adminHeaders })).status()).toBe(204);
    expect((await request.delete(`/schema/collections/${collection}?destructive=true`, { headers: adminHeaders })).status()).toBe(204);
  }
});
