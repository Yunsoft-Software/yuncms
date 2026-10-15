import { expect } from '@playwright/test';

export function isolateCreatedFlows(test) {
  let baseline, headers;
  test.beforeEach(async ({ request }) => {
    const login = await request.post('/auth/login', { data: { email: 'flows-admin@example.test', password: 'Browser-flow-fixture-123!' } });
    expect(login.status()).toBe(200); headers = { authorization: `Bearer ${(await login.json()).data.access_token}` };
    const response = await request.get('/flows', { headers }); expect(response.status()).toBe(200);
    baseline = new Set((await response.json()).data.map(flow => flow.id));
  });
  test.afterEach(async ({ request }) => {
    const response = await request.get('/flows', { headers }); expect(response.status()).toBe(200);
    for (const flow of (await response.json()).data) if (!baseline.has(flow.id)) {
      expect((await request.delete(`/flows/${flow.id}?revision=${flow.revision}`, { headers })).status()).toBe(204);
    }
  });
}
