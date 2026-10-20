import { test, expect } from '@playwright/test';

test('actual browser MCP HTTP rejects excessive elements and body bytes and recovers for a valid native read', async ({ page, request, baseURL }) => {
  const login = await request.post('/auth/login', { data: { email: 'flows-admin@example.test', password: 'Browser-flow-fixture-123!' } });
  expect(login.status()).toBe(200); const session = (await login.json()).data, headers = { authorization: `Bearer ${session.access_token}` };
  const endpoint = new URL(baseURL);
  const enabled = await request.patch('/mcp/settings', { headers, data: { enabled: true, writes_enabled: false, require_authentication: true,
    allowed_hosts: [endpoint.host], allowed_origins: [endpoint.origin] } });
  expect(enabled.status()).toBe(200);
  try {
    await page.addInitScript(session => { sessionStorage.setItem('yuncms.studio.session', JSON.stringify(session)); localStorage.setItem('yuncms.studio.locale', 'en'); }, session);
    await page.goto('/#/content/browser_flow_records');
    const rpc = payload => page.evaluate(async ({ token, payload }) => {
      const response = await fetch('/mcp', { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json',
        accept: 'application/json, text/event-stream', 'mcp-protocol-version': '2025-11-25' }, body: JSON.stringify(payload) });
      const text = await response.text(); const encoded = text.trim().startsWith('{') ? text : text.split('\n').filter(line => line.startsWith('data: ')).at(-1)?.slice(6);
      return { status: response.status, body: encoded ? JSON.parse(encoded) : null };
    }, { token: session.access_token, payload });
    const initialized = await rpc({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'YunCMS browser acceptance', version: '1' } } });
    expect(initialized.status).toBe(200); expect(initialized.body.result.protocolVersion).toBe('2025-11-25');
    const rejected = await rpc({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'items.read_many', arguments: {
      collection: 'browser_flow_records', filter: Object.fromEntries(Array.from({ length: 10_001 }, (_, i) => ['field_' + i, 0])),
    } } });
    expect(rejected.status).toBe(200); expect(rejected.body.result.isError).toBe(true);
    expect(JSON.stringify(rejected.body.result.content)).toMatch(/maximum of 10000 elements/);
    const oversized = await rpc({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'items.read_many', arguments: { padding: 'x'.repeat(1024 * 1024) } } });
    expect(oversized.status).toBe(413);
    const recovered = await rpc({ jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'items.read_many', arguments: { collection: 'browser_flow_records', fields: ['id', 'title'], limit: 1 } } });
    expect(recovered.status).toBe(200); expect(recovered.body.result.isError).not.toBe(true);
    const value = JSON.parse(recovered.body.result.content[0].text); expect(value.data.data).toHaveLength(1);
    await page.reload(); await expect(page.locator('tbody tr').first()).toBeVisible();
  } finally { expect((await request.patch('/mcp/settings', { headers, data: { enabled: false } })).status()).toBe(200); }
});
