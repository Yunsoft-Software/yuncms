import { test, expect } from '@playwright/test';
import { createInterruptedFieldFixture } from '../helpers/interrupted-field-fixture.mjs';

test('real browser explicitly recovers a SIGKILL-interrupted native field and reloads preserved content', async ({ page }) => {
  const f = await createInterruptedFieldFixture(); let accepted = false;
  try {
    await f.interrupt();
    await f.database.query('UPDATE recovery_records SET content=? WHERE id=?', ['Preserved across real worker interruption', f.row.id]);
    await page.goto(f.origin + '/health');
    const result = await page.evaluate(async ({ email, password, id }) => {
      const post = async (path, body, token) => {
        const response = await fetch(path, { method: 'POST', headers: { 'content-type': 'application/json', ...(token ? { authorization: 'Bearer ' + token } : {}) }, body: JSON.stringify(body) });
        return { status: response.status, body: response.status === 204 ? null : await response.json() };
      };
      const login = await post('/auth/login', { email, password });
      if (login.status !== 200) throw Error('Native recovery administrator login failed');
      const token = login.body.data.access_token, definition = { field: 'content', type: 'text' };
      try {
        const path = '/schema/collections/recovery_records/fields/content/recovery';
        const preview = await post(path + '/inspect', { definition }, token);
        const recovered = await post(path, { definition, confirm: true, expectedSignature: preview.body.data.signature }, token);
        const response = await fetch('/items/recovery_records/' + id, { headers: { authorization: 'Bearer ' + token } });
        return { preview: preview.status, compatible: preview.body.data.compatible, recovered: recovered.status, content: (await response.json()).data.content };
      } finally { await post('/auth/logout', {}, token); }
    }, { email: f.admin.email, password: f.password, id: f.row.id });
    expect(result).toEqual({ preview: 200, compatible: true, recovered: 201, content: 'Preserved across real worker interruption' });
    await page.reload();
    expect((await f.database.query('SELECT content FROM recovery_records WHERE id=?', [f.row.id]))[0][0].content).toBe(result.content);
    accepted = true;
  } finally { await f.close({ preserve: !accepted }); }
});
