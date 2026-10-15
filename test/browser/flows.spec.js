import { test, expect } from '@playwright/test';
import { isolateCreatedFlows } from './fixtures/flow-isolation.js';

isolateCreatedFlows(test);

const password = 'Browser-flow-fixture-123!';
async function apiLogin(request, email = 'flows-admin@example.test') {
  const response = await request.post('/auth/login', { data: { email, password } }); expect(response.status()).toBe(200); return (await response.json()).data;
}
async function authenticate(page, request, email) {
  const session = await apiLogin(request, email);
  await page.addInitScript(value => { sessionStorage.setItem('yuncms.studio.session', JSON.stringify(value)); localStorage.setItem('yuncms.studio.locale', 'en'); }, session);
  return session;
}
async function createFlow(request, session, name, extra = {}) {
  const response = await request.post('/flows', { headers: { authorization: `Bearer ${session.access_token}` }, data: {
    name, description: '', status: 'active', trigger: 'manual', accountability: 'trigger', options: { response: '$last', require_confirmation: true }, entry: 'output',
    operations: [{ id: 'output', key: 'output', name: 'Output', type: 'transform', position: { x: 380, y: 100 }, options: { value: { message: 'Hello {{ $trigger.body.name }}' } }, resolve: null, reject: null }], ...extra,
  } }); expect(response.status()).toBe(201); return (await response.json()).data;
}
async function selectTrigger(page) { await page.locator('.react-flow__node[data-id="trigger"]').click(); }
async function connect(page, source, target, branch = 'resolve') {
  const from = page.locator(`.react-flow__node[data-id="${source}"] .react-flow__handle[data-handleid="${branch}"]`);
  const to = page.locator(`.react-flow__node[data-id="${target}"] .react-flow__handle[data-handleid="input"]`);
  await from.scrollIntoViewIfNeeded();
  const a = await from.boundingBox(), b = await to.boundingBox(); expect(a).toBeTruthy(); expect(b).toBeTruthy();
  await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2); await page.mouse.down();
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 16 }); await page.mouse.up();
}

test('native browser login exposes Flow navigation only to administrators', async ({ page }) => {
  await page.goto('/'); await page.getByLabel('Email', { exact: true }).fill('flows-admin@example.test'); await page.getByLabel('Password', { exact: true }).fill(password);
  const signedIn = page.waitForResponse(response => response.url().endsWith('/auth/login') && response.request().method() === 'POST');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click(); expect((await signedIn).status()).toBe(200);
  await page.goto('/#/flows/new'); await expect(page.getByTestId('flow-canvas')).toBeVisible();
  await expect(page.locator('.flow-inspector').getByLabel('Execution permissions')).toHaveValue('trigger');
});

test('create, drag, connect, save, reload and run a manual Flow against the native API', async ({ page, request }) => {
  await authenticate(page, request); await page.goto('/#/flows/new');
  await page.locator('.flow-inspector').getByLabel('Name', { exact: true }).fill('Browser created flow');
  await page.getByRole('button', { name: 'Add operation', exact: true }).click();
  const id = await page.locator('.react-flow__node:not([data-id="trigger"])').getAttribute('data-id');
  await expect(page.getByLabel('Operation options (JSON)', { exact: true })).toBeVisible();
  await page.getByLabel('Operation options (JSON)', { exact: true }).fill(JSON.stringify({ value: { greeting: 'Hello {{ $trigger.body.name }}' } }));
  await connect(page, 'trigger', id); await expect(page.locator('.react-flow__edge')).toHaveCount(1);
  const target = page.locator(`.react-flow__node[data-id="${id}"] strong`); const position = await target.boundingBox();
  await page.mouse.move(position.x + 20, position.y + 8); await page.mouse.down(); await page.mouse.move(position.x + 65, position.y + 55, { steps: 8 }); await page.mouse.up();
  await selectTrigger(page); await page.locator('.flow-inspector').getByLabel('Status', { exact: true }).selectOption('active');
  const saved = page.waitForResponse(response => response.url().endsWith('/flows') && response.request().method() === 'POST');
  await page.getByRole('button', { name: 'Save', exact: true }).click(); expect((await saved).status()).toBe(201);
  await expect(page).toHaveURL(/#\/flows\/[a-f0-9-]+$/); await page.reload(); await expect(page.locator('.react-flow__edge')).toHaveCount(1);
  await page.getByRole('button', { name: 'Run saved flow', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Run saved flow', exact: true }).click();
  await expect(page.getByTestId('flow-run-output')).toContainText('Hello YunCMS');
  await page.screenshot({ path: `.yuncms/flows-tests/${test.info().project.name}/flow-editor-desktop.png`, fullPage: true });
});

test('condition success/failure connections merge into a shared node and survive persistence', async ({ page, request }) => {
  const session = await authenticate(page, request);
  const nodes = [
    { id: 'condition', key: 'condition', name: 'Condition', type: 'condition', options: { rules: { '$trigger.body.approved': { _eq: true } } }, position: { x: 360, y: 200 }, resolve: null, reject: null },
    { id: 'yes', key: 'yes', name: 'Accepted', type: 'transform', options: { value: { accepted: true } }, position: { x: 700, y: 60 }, resolve: null, reject: null },
    { id: 'no', key: 'no', name: 'Rejected', type: 'transform', options: { value: { accepted: false } }, position: { x: 700, y: 360 }, resolve: null, reject: null },
    { id: 'finish', key: 'finish', name: 'Merged result', type: 'transform', options: { value: '{{ $last }}' }, position: { x: 1040, y: 200 }, resolve: null, reject: null },
  ];
  const flow = await createFlow(request, session, 'Branching flow', { entry: null, status: 'inactive', operations: nodes });
  await page.goto(`/#/flows/${flow.id}`); await expect(page.locator('.react-flow__node')).toHaveCount(5);
  for (const [source, target, branch] of [['trigger', 'condition'], ['condition', 'yes', 'resolve'], ['condition', 'no', 'reject'], ['yes', 'finish'], ['no', 'finish']]) await connect(page, source, target, branch);
  await expect(page.locator('.react-flow__edge')).toHaveCount(5);
  await selectTrigger(page); await page.locator('.flow-inspector').getByLabel('Status', { exact: true }).selectOption('active');
  const saved = page.waitForResponse(response => response.url().endsWith(`/flows/${flow.id}`) && response.request().method() === 'PUT');
  await page.getByRole('button', { name: 'Save', exact: true }).click(); expect((await saved).status()).toBe(200);
  await page.reload(); await expect(page.locator('.react-flow__edge')).toHaveCount(5);
  await page.getByRole('button', { name: 'Run saved flow', exact: true }).click();
  await page.getByRole('dialog').getByLabel('Trigger payload (JSON)', { exact: true }).fill('{"body":{"approved":false}}');
  await page.getByRole('dialog').getByRole('button', { name: 'Run saved flow', exact: true }).click();
  await expect(page.getByTestId('flow-run-output')).toContainText('false');
  await expect(page.locator('.flow-node-failed')).toHaveCount(1);
});

test('a saved graph retains visible nodes and connections across repeated real page reloads', async ({ page, request }, info) => {
  test.setTimeout(Math.max(info.timeout, 60000));
  const consoleMessages = []; page.on('console', message => { if (['warning', 'error'].includes(message.type())) consoleMessages.push(message.text()); });
  const session = await authenticate(page, request), flow = await createFlow(request, session, 'Canvas reload regression');
  try {
    await page.goto(`/#/flows/${flow.id}`);
    for (let attempt = 0; attempt < 16; attempt++) {
      if (attempt) await page.reload();
      await expect(page.locator('.react-flow__node[data-id="output"]')).toBeVisible();
      await expect(page.locator('.react-flow__edge')).toHaveCount(1);
    }
  } catch (error) {
    const layout = await page.locator('.react-flow').evaluate(root => {
      const elements = [...root.querySelectorAll('.react-flow__viewport, .react-flow__node, .react-flow__node > div, .react-flow__handle')].map(element => {
      const rect = element.getBoundingClientRect(), style = getComputedStyle(element);
      return { class: element.className, x: rect.x, y: rect.y, width: rect.width, height: rect.height, display: style.display, visibility: style.visibility, transform: style.transform };
      });
      // Read-only failure diagnostics; no store/network/clock mutation is used by this test.
      const nested = root.querySelector('.react-flow__node') ?? root;
      let fiber = nested[Object.keys(nested).find(key => key.startsWith('__reactFiber$'))], state;
      while (fiber) { if (typeof fiber.memoizedProps?.value?.getState === 'function') { state = fiber.memoizedProps.value.getState(); break; } fiber = fiber.return; }
      return { elements, state: state ? { width: state.width, height: state.height, edges: state.edges, nodes: [...state.nodeLookup.values()].map(node => ({ id: node.id, measured: node.measured, handles: node.internals.handleBounds })) } : null };
    });
    await info.attach('browser-console', { body: JSON.stringify(consoleMessages), contentType: 'application/json' });
    await info.attach('actual-canvas-layout', { body: JSON.stringify(layout, null, 2), contentType: 'application/json' }); throw error;
  } finally { await request.delete(`/flows/${flow.id}?revision=${flow.revision}`, { headers: { authorization: `Bearer ${session.access_token}` } }); }
});

test('invalid JSON blocks saving and deleting a node clears dangling trigger connections', async ({ page, request }) => {
  const session = await authenticate(page, request); const flow = await createFlow(request, session, 'Node deletion flow');
  await page.goto(`/#/flows/${flow.id}`); await page.locator('.react-flow__node[data-id="output"]').click();
  await page.getByLabel('Operation options (JSON)', { exact: true }).fill('{broken');
  await expect(page.getByRole('button', { name: 'Save', exact: true })).toBeDisabled(); await expect(page.getByRole('alert')).toContainText('valid JSON');
  await page.getByLabel('Operation options (JSON)', { exact: true }).fill('{"value":42}'); await expect(page.getByRole('button', { name: 'Save', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Remove operation', exact: true }).click(); await expect(page.locator('.react-flow__edge')).toHaveCount(0);
  await page.locator('.flow-inspector').getByLabel('Status', { exact: true }).selectOption('inactive');
  const saved = page.waitForResponse(response => response.url().endsWith(`/flows/${flow.id}`) && response.request().method() === 'PUT');
  await page.getByRole('button', { name: 'Save', exact: true }).click(); const body = await (await saved).json(); expect(body.data.entry).toBeNull(); expect(body.data.operations).toEqual([]);
});

test('export and import preserve the graph while imports and duplicates start inactive', async ({ page, request }) => {
  const session = await authenticate(page, request); const flow = await createFlow(request, session, 'Portable flow');
  await page.goto(`/#/flows/${flow.id}`); await expect(page.getByTestId('flow-canvas')).toBeVisible();
  const downloadEvent = page.waitForEvent('download'); await page.getByRole('button', { name: 'Export', exact: true }).click(); const download = await downloadEvent; expect(download.suggestedFilename()).toBe('Portable-flow.json');
  await page.getByRole('button', { name: 'Duplicate', exact: true }).click(); await expect(page.locator('.flow-inspector').getByLabel('Status', { exact: true })).toHaveValue('inactive');
  await page.getByRole('button', { name: 'Import', exact: true }).click(); const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Flow definition (JSON)', { exact: true }).fill(JSON.stringify({ ...flow, name: 'Imported flow' }));
  await dialog.getByRole('button', { name: 'Import', exact: true }).click();
  await expect(page.locator('.flow-inspector').getByLabel('Name', { exact: true })).toHaveValue('Imported flow');
  await expect(page.locator('.flow-inspector').getByLabel('Status', { exact: true })).toHaveValue('inactive');
  await expect(page.locator('.react-flow__node')).toHaveCount(2);
});

test('staff cannot open the Flow manager and can run only explicitly granted collection actions', async ({ page, request }) => {
  const admin = await apiLogin(request), rolesResponse = await request.get('/roles', { headers: { authorization: `Bearer ${admin.access_token}` } });
  const role = (await rolesResponse.json()).data.find(role => role.name === 'Browser flow staff');
  const flow = await createFlow(request, admin, 'Allowed content action', { options: { response: '$last', collections: ['browser_flow_records'], allowed_roles: [role.id], require_confirmation: true, require_selection: true }, operations: [{ id: 'output', key: 'output', name: 'Output', type: 'transform', position: { x: 380, y: 100 }, options: { value: 'Done' }, resolve: null, reject: null }] });
  await authenticate(page, request, 'flows-staff@example.test'); await page.goto('/#/flows'); await expect(page.getByRole('alert')).toContainText('requires an administrator'); await expect(page.getByTestId('flow-canvas')).toHaveCount(0);
  await page.goto('/#/content/browser_flow_records'); const action = page.getByRole('button', { name: 'Allowed content action', exact: true }); await expect(action).toBeDisabled();
  await page.locator('tbody input[type="checkbox"]').first().check(); await expect(action).toBeEnabled(); await action.click();
  await page.getByRole('dialog').getByRole('button', { name: 'Run saved flow', exact: true }).click(); await expect(page.getByText('Flow finished.', { exact: true })).toBeVisible();
  const runs = await request.get(`/flows/${flow.id}/runs`, { headers: { authorization: `Bearer ${admin.access_token}` } }); expect((await runs.json()).data).toHaveLength(1);
});

test('mobile and dark Flow layouts use central tokens without horizontal page overflow', async ({ page, request }) => {
  const session = await authenticate(page, request); const flow = await createFlow(request, session, 'Responsive flow');
  await page.setViewportSize({ width: 390, height: 844 }); await page.goto(`/#/flows/${flow.id}`); await expect(page.getByTestId('flow-canvas')).toBeVisible();
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
  await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'dark'));
  const surface = await page.evaluate(() => { const probe = document.createElement('span'); probe.style.backgroundColor = 'var(--studio-surface)'; document.body.append(probe); const color = getComputedStyle(probe).backgroundColor; probe.remove(); return color; });
  await expect(page.locator('.flow-graph-node').first()).toHaveCSS('background-color', surface);
  await page.screenshot({ path: `.yuncms/flows-tests/${test.info().project.name}/flow-editor-mobile-dark.png`, fullPage: true });
});

test('flow deletion uses the shared confirmation dialog and removes the saved graph', async ({ page, request }) => {
  const session = await authenticate(page, request); const flow = await createFlow(request, session, 'Delete browser flow');
  await page.goto(`/#/flows/${flow.id}`); await page.getByRole('button', { name: 'Delete', exact: true }).click();
  const dialog = page.getByRole('dialog'); await expect(dialog).toContainText('run history');
  await dialog.getByRole('button', { name: 'Confirm', exact: true }).click();
  await expect(page).toHaveURL(/#\/flows\/new$/);
  const response = await request.get(`/flows/${flow.id}`, { headers: { authorization: `Bearer ${session.access_token}` } }); expect(response.status()).toBe(404);
});
