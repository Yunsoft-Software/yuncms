import { test, expect } from '@playwright/test';

function messageText(raw) {
  const split = raw.indexOf('\r\n\r\n'), headers = raw.slice(0, split), body = raw.slice(split + 4);
  if (/Content-Transfer-Encoding:\s*base64/i.test(headers)) return Buffer.from(body.replace(/\s/g, ''), 'base64').toString('utf8');
  if (/Content-Transfer-Encoding:\s*quoted-printable/i.test(headers)) return body.replace(/=\r?\n/g, '').replace(/=([0-9a-f]{2})/ig, (_, hex) => String.fromCharCode(Number.parseInt(hex, 16)));
  return body;
}

test('public registration, real SMTP verification and password reset complete through native Studio forms', async ({ page, browser, request, baseURL }, info) => {
  test.setTimeout(180000);
  const response = await request.post('/auth/login', { data: { email: 'flows-admin@example.test', password: 'Browser-flow-fixture-123!' } });
  expect(response.status()).toBe(200); const session = (await response.json()).data;
  const headers = { authorization: 'Bearer ' + session.access_token };
  const before = (await (await request.get('/studio-settings/admin', { headers })).json()).data;
  const suffix = crypto.randomUUID(), email = `registered-${suffix}@example.test`, password = 'Public-native-fixture-123!', newPassword = 'Reset-native-fixture-456!';
  let role, user, guestContext;
  const send = async (path, method, data) => {
    const result = await request.fetch(path, { method, headers, ...(data === undefined ? {} : { data }) });
    expect(result.ok(), path + ' HTTP ' + result.status()).toBe(true);
    return result.status() === 204 ? null : (await result.json()).data;
  };
  const mail = async action => {
    let raw = '';
    await expect.poll(async () => {
      const result = await send('/extensions/flow-fixture', 'GET');
      raw = result.messages.filter(message => message.to.some(recipient => recipient.includes(email))).map(message => messageText(message.raw)).findLast(text => text.includes('auth_action=' + action)) || '';
      return raw;
    }, { timeout: 15000 }).toContain('auth_action=' + action);
    const link = raw.match(new RegExp('https?://[^\\s<>]+auth_action=' + action + '[^\\s<>]+'))?.[0];
    expect(link).toBeTruthy(); expect(new URL(link).origin).toBe(baseURL); return link;
  };
  try {
    role = await send('/roles', 'POST', { name: 'Registration fixture ' + suffix });
    await page.addInitScript(value => { sessionStorage.setItem('yuncms.studio.session', JSON.stringify(value)); localStorage.setItem('yuncms.studio.locale', 'en'); }, session);
    await page.goto('/#/appearance');
    const registration = page.getByRole('region', { name: 'Public Registration', exact: true });
    await expect(registration).toBeVisible();
    await registration.getByRole('combobox', { name: /^Registered user role/ }).selectOption(role.id);
    await registration.getByRole('checkbox', { name: /^Allow public registration/ }).check();
    await registration.getByRole('checkbox', { name: /^Require email verification/ }).check();
    const saving = page.waitForResponse(result => new URL(result.url()).pathname === '/studio-settings' && result.request().method() === 'PATCH');
    await registration.getByRole('button', { name: 'Save', exact: true }).click(); expect((await saving).status()).toBe(200);
    await page.reload(); await expect(registration.getByRole('checkbox', { name: /^Require email verification/ })).toBeChecked();
    guestContext = await browser.newContext(); const guest = await guestContext.newPage();
    await guest.addInitScript(() => localStorage.setItem('yuncms.studio.locale', 'en'));
    await guest.goto(baseURL);
    for (const width of [320, 390, 820, 1100, 1680]) {
      await guest.setViewportSize({ width, height: 900 }); await expect(guest.locator('.auth-card')).toBeVisible();
      expect(await guest.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
      await guest.screenshot({ path: info.outputPath(`login-${width}.png`), fullPage: true });
    }
    await guest.getByRole('button', { name: 'Create an account', exact: true }).click();
    await guest.getByLabel('Email', { exact: true }).fill(email); await guest.getByLabel('Password', { exact: true }).fill(password);
    await guest.getByLabel('Confirm password', { exact: true }).fill(password);
    const creating = guest.waitForResponse(result => new URL(result.url()).pathname === '/auth/register');
    await guest.getByRole('button', { name: 'Create account', exact: true }).click(); expect((await creating).status()).toBe(201);
    user = (await send('/users?search=' + encodeURIComponent(email) + '&limit=100', 'GET')).find(entry => entry.email === email);
    expect(user.role).toBe(role.id); expect(user.email_verified_at).toBeNull();
    expect((await request.post('/auth/login', { data: { email, password } })).status()).toBe(403);
    await guest.goto(await mail('verify')); await expect(guest.getByRole('status')).toContainText('successfully');
    const login = await request.post('/auth/login', { data: { email, password } }); expect(login.status()).toBe(200);
    const priorHeaders = { authorization: 'Bearer ' + (await login.json()).data.access_token };
    await guest.goto(baseURL); await guest.getByRole('button', { name: 'Forgot password?', exact: true }).click();
    await guest.getByLabel('Email', { exact: true }).fill(email);
    const reset = guest.waitForResponse(result => new URL(result.url()).pathname === '/auth/password-reset/request');
    await guest.getByRole('button', { name: 'Send reset link', exact: true }).click(); expect((await reset).status()).toBe(202);
    const resetUrl = await mail('reset'); await guest.goto(resetUrl);
    await guest.getByLabel('New password', { exact: true }).fill(newPassword); await guest.getByLabel('Confirm password', { exact: true }).fill(newPassword);
    await guest.getByRole('button', { name: 'Set new password', exact: true }).click();
    await expect(guest.getByRole('status')).toContainText('Existing sessions were revoked');
    expect((await request.get('/users/me', { headers: priorHeaders })).status()).toBe(401);
    expect((await request.post('/auth/login', { data: { email, password } })).status()).toBe(401);
    expect((await request.post('/auth/login', { data: { email, password: newPassword } })).status()).toBe(200);
    await guest.goto(resetUrl); await guest.getByLabel('New password', { exact: true }).fill(password); await guest.getByLabel('Confirm password', { exact: true }).fill(password);
    await guest.getByRole('button', { name: 'Set new password', exact: true }).click(); await expect(guest.getByRole('status')).toContainText('failed');
  } finally {
    await guestContext?.close();
    await send('/studio-settings', 'PATCH', { public_registration_enabled: before.public_registration_enabled, public_registration_role: before.public_registration_role, public_registration_require_email_verification: before.public_registration_require_email_verification });
    if (!user) user = (await send('/users?search=' + encodeURIComponent(email) + '&limit=100', 'GET')).find(entry => entry.email === email);
    if (user) await send('/users/' + user.id, 'DELETE');
    if (role) await send('/roles/' + role.id, 'DELETE');
  }
});
