import { expect } from '@playwright/test';

async function allFlows(request, headers) {
  const flows = [];
  for (let offset = 0; ; offset += 100) {
    const response = await request.get(`/flows?limit=100&offset=${offset}&summary=1`, { headers }); expect(response.status()).toBe(200);
    const rows = (await response.json()).data; flows.push(...rows);
    if (rows.length < 100) return flows;
  }
}

export function isolateCreatedFlows(test) {
  let baseline, headers;
  test.beforeEach(async ({ request }) => {
    const login = await request.post('/auth/login', { data: { email: 'flows-admin@example.test', password: 'Browser-flow-fixture-123!' } });
    expect(login.status()).toBe(200); headers = { authorization: `Bearer ${(await login.json()).data.access_token}` };
    baseline = new Set((await allFlows(request, headers)).map(flow => flow.id));
  });
  test.afterEach(async ({ request }) => {
    for (const flow of await allFlows(request, headers)) if (!baseline.has(flow.id)) {
      expect((await request.delete(`/flows/${flow.id}?revision=${flow.revision}`, { headers })).status()).toBe(204);
    }
  });
}
