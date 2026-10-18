import { test, expect } from '@playwright/test';

const password = 'Browser-flow-fixture-123!';
async function signIn(request, email = 'flows-admin@example.test') {
  const response = await request.post('/auth/login', { data: { email, password } });
  expect(response.status()).toBe(200);
  const session = (await response.json()).data;
  return { session, headers: { authorization: `Bearer ${session.access_token}` } };
}
async function openAi(page, session) {
  await page.addInitScript(session => {
    sessionStorage.setItem('yuncms.studio.session', JSON.stringify(session));
    localStorage.setItem('yuncms.studio.locale', 'en');
  }, session);
  await page.goto('/#/ai');
}

test('administrator chooses independent compatible providers or a custom URL and persists optional gateway routing without exposing secrets', async ({ page, request }) => {
  const { session, headers } = await signIn(request);
  await openAi(page, session);
  try {
    await page.getByRole('region', { name: 'AI', exact: true }).getByRole('button', { name: 'Settings', exact: true }).click();
    const panel = page.locator('.ai-settings-panel');
    const provider = panel.getByRole('combobox', { name: 'Provider', exact: true });
    const base = panel.getByRole('textbox', { name: 'Provider URL', exact: true });
    for (const [id, url] of [['zai', 'https://api.z.ai/api/paas/v4'], ['deepseek', 'https://api.deepseek.com'],
      ['groq', 'https://api.groq.com/openai/v1'], ['openai', 'https://api.openai.com/v1'], ['openrouter', 'https://openrouter.ai/api/v1']]) {
      await provider.selectOption(id); await expect(base).toHaveValue(url);
      await expect(panel.getByRole('checkbox', { name: /^Enable AI/ })).not.toBeChecked();
      await expect(panel.getByLabel('API key', { exact: true })).toHaveValue('');
    }
    await panel.getByLabel('Model', { exact: true }).fill('provider-owned-model-id');
    await panel.getByLabel('API key', { exact: true }).fill('Synthetic-provider-browser-key');
    await panel.locator('summary').click();
    const routing = panel.getByRole('textbox', { name: 'Gateway routing (optional JSON)', exact: true });
    await routing.fill('{bad'); await expect(panel.getByRole('button', { name: 'Save settings', exact: true })).toBeDisabled();
    const configured = { only: ['provider-a', 'provider-b'], order: ['provider-b', 'provider-a'], quantizations: ['bf16'], require_parameters: true, allow_fallbacks: false };
    await routing.fill(JSON.stringify(configured));
    const saved = page.waitForResponse(response => response.url().endsWith('/ai/settings') && response.request().method() === 'PATCH');
    await panel.getByRole('button', { name: 'Save settings', exact: true }).click(); expect((await saved).status()).toBe(200);
    await page.reload(); await page.getByRole('region', { name: 'AI', exact: true }).getByRole('button', { name: 'Settings', exact: true }).click();
    await expect(provider).toHaveValue('openrouter'); await expect(base).toHaveValue('https://openrouter.ai/api/v1');
    await expect(panel.getByLabel('Model', { exact: true })).toHaveValue('provider-owned-model-id');
    await expect(panel.getByLabel('API key', { exact: true })).toHaveValue('');
    await panel.locator('summary').click(); expect(JSON.parse(await routing.inputValue())).toEqual(configured);
    const settings = (await (await request.get('/ai/settings', { headers })).json()).data;
    expect(settings.provider).toEqual(configured); expect(settings.has_api_key).toBe(true);
    expect(JSON.stringify(settings)).not.toContain('Synthetic-provider-browser-key');
    await page.screenshot({ path: '.yuncms/flows-tests/provider-settings.png', fullPage: true });
    await provider.selectOption('custom'); await base.fill('https://my-compatible.example.test/inference/v1');
    const customSaved = page.waitForResponse(response => response.url().endsWith('/ai/settings') && response.request().method() === 'PATCH');
    await panel.getByRole('button', { name: 'Save settings', exact: true }).click(); expect((await customSaved).status()).toBe(200);
    await page.reload(); await page.getByRole('region', { name: 'AI', exact: true }).getByRole('button', { name: 'Settings', exact: true }).click();
    await expect(provider).toHaveValue('custom'); await expect(base).toHaveValue('https://my-compatible.example.test/inference/v1');
    const custom = (await (await request.get('/ai/settings', { headers })).json()).data;
    expect(custom.has_api_key).toBe(false); expect(custom.enabled).toBe(false); expect(custom.provider).toBe(null);
  } finally {
    // Restore the actual disposable server's default-deny AI fixture for later browser scenarios.
    const reset = await request.patch('/ai/settings', { headers, data: { base_url: 'https://invalid.invalid/v1', api_key: 'disposable-invalid-key',
      model: 'unused', provider: null, enabled: true, writes_enabled: true } });
    expect(reset.status()).toBe(200);
  }
});

test('ordinary users cannot see provider settings or replace server-owned routing through the native API', async ({ page, request }) => {
  const { session, headers } = await signIn(request, 'flows-staff@example.test');
  await openAi(page, session);
  await expect(page.locator('.ai-settings-panel')).toHaveCount(0);
  await expect(page.getByRole('region', { name: 'AI', exact: true }).getByRole('button', { name: 'Settings', exact: true })).toHaveCount(0);
  expect((await request.get('/ai/settings', { headers })).status()).toBe(403);
  expect((await request.patch('/ai/settings', { headers, data: { provider: { only: ['untrusted'] } } })).status()).toBe(403);
});
