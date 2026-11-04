import { expect } from '@playwright/test';
export async function openAiFlowEditor(page, session, actor, name) {
  await page.addInitScript(session => { sessionStorage.setItem('yuncms.studio.session', JSON.stringify(session)); localStorage.setItem('yuncms.studio.locale', 'en'); }, session);
  await page.goto('/#/flows/new');
  await page.locator('.flow-inspector').getByLabel('Name', { exact: true }).fill(name);
  await page.getByRole('combobox', { name: 'Execution permissions', exact: true }).selectOption('user');
  await page.getByRole('combobox', { name: 'Run as', exact: true }).selectOption(actor.id);
  await page.getByRole('combobox', { name: 'Operations', exact: true }).selectOption('ai');
  await page.getByRole('button', { name: 'Add operation', exact: true }).click();
  await page.locator('.flow-ai-fields').getByRole('combobox', { name: 'Collection', exact: true }).selectOption('browser_flow_records');
  await page.getByRole('group', { name: 'Input fields', exact: true }).locator('label').filter({ hasText: 'title' }).getByRole('checkbox').check();
  await page.getByRole('group', { name: 'Output fields', exact: true }).locator('label').filter({ hasText: 'status' }).getByRole('checkbox').check();
  await page.getByRole('textbox', { name: 'AI instruction', exact: true }).fill('Copy title to status.');
  await page.locator('.flow-ai-preview').locator('summary').click();
  await expect(page.getByLabel('Sample record key', { exact: true })).toBeVisible();
}
export async function removeAiFlow(request, headers, id) {
  if (!id) return;
  const read = await request.get('/flows/' + id, { headers }); expect(read.status()).toBe(200);
  const flow = (await read.json()).data;
  expect((await request.delete(`/flows/${id}?revision=${flow.revision}`, { headers })).status()).toBe(204);
}
