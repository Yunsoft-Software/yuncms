import { test, expect } from '@playwright/test';
import { createWhiteLabelFixture } from '../helpers/white-label-fixture.mjs';
import { translate } from '../../apps/studio/src/localization.js';
import { expectReadableText } from '../helpers/studio-contrast.mjs';

test('real Free/Premium UI: fixed vendor identity, upgrade discovery, opted-in customer branding and cold anonymous login', async ({ page, browser }, testInfo) => {
  const f = await createWhiteLabelFixture(); let accepted = false;
  const contexts = [];
  try {
    const adminToken = (await f.login(f.admin)).access_token;
    const logo = await f.upload(adminToken, { name: 'Acme customer logo.svg' });
    await page.addInitScript(() => { localStorage.setItem('yuncms.studio.locale', 'en'); localStorage.setItem('yuncms.support-dismissed', '1'); });
    await page.goto(f.origin + '/#/features');
    await page.locator('input[type=email]').fill(f.admin.email);
    await page.locator('input[type=password]').fill(f.password);
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Features and license', exact: true })).toBeVisible();
    await expect(page.getByRole('checkbox', { name: 'White-label branding', exact: true })).toBeDisabled();
    const campaign = '?utm_source=studio&utm_medium=yuncms&utm_campaign=yuncms-premium';
    await expect(page.locator('.premium-upsell').first()).toHaveAttribute('href', 'https://yunsoft.com/contact' + campaign);
    await expect(page.locator('.studio-brand[href="https://yunsoft.com"]').first()).toBeVisible();
    await page.goto(f.origin + '/#/appearance');
    await expect(page.getByLabel('Brand name', { exact: true })).toHaveCount(0);
    await page.getByLabel('My language', { exact: true }).selectOption('tr');
    await expect(page.locator('main .premium-upsell')).toHaveAttribute('href', 'https://yunsoft.com/tr/iletisim' + campaign);
    await page.getByLabel(translate('tr', 'appearance.currentLanguage'), { exact: true }).selectOption('en');
    await page.locator('input[type=color]').fill('#4f46e5');
    await page.getByRole('form', { name: 'Branding & Appearance', exact: true }).getByRole('button', { name: 'Save', exact: true }).click();
    await expect(page.getByText('Studio appearance settings saved.', { exact: true })).toBeVisible();
    expect((await f.request('/studio-settings')).body.data.brand_name).toBe('YunCMS');

    await page.setViewportSize({ width: 1440, height: 1000 });
    for (const theme of ['dark', 'light']) {
      expect((await f.request('/studio-settings', { method: 'PATCH', token: adminToken, body: { theme } })).status).toBe(200);
      await page.goto(f.origin + '/?white_label_theme=' + theme + '#/appearance');
      await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
      await expectReadableText(page.locator('main .premium-upsell'));
      await expectReadableText(page.locator('.sidebar-footer .premium-upsell'));
      await page.screenshot({ path: testInfo.outputPath(`free-upgrade-${theme}-1440.png`), fullPage: true });
    }

    const widths = [320, 390, 768, 820, 1024, 1280, 1920];
    for (const width of widths) {
      await page.setViewportSize({ width, height: width < 600 ? 844 : 1000 });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await page.screenshot({ path: testInfo.outputPath(`free-appearance-${width}.png`), fullPage: true });
    }
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto(f.origin + '/#/features');
    await page.getByLabel('Signed license', { exact: true }).fill(f.issue());
    await page.getByRole('button', { name: 'Activate license', exact: true }).click();
    const whiteLabel = page.getByRole('checkbox', { name: 'White-label branding', exact: true });
    await expect(whiteLabel).toBeEnabled(); await expect(whiteLabel).not.toBeChecked();
    await expect(page.locator('.premium-upsell')).toHaveCount(0);
    await whiteLabel.check(); await expect(whiteLabel).toBeChecked();
    await expect(page.locator('.studio-brand[href="https://yunsoft.com"]')).toHaveCount(0);
    await page.goto(f.origin + '/#/appearance');
    await page.getByLabel('Brand name', { exact: true }).fill('Acme Workspace');
    await page.locator('.brand-asset-picker').first().getByRole('button').first().click();
    const picker = page.getByRole('dialog');
    await picker.getByRole('option').filter({ hasText: logo.title || logo.filename_download }).click();
    await picker.getByRole('button', { name: translate('en', 'filePicker.useSelected'), exact: true }).click();
    await page.getByRole('form', { name: 'Branding & Appearance', exact: true }).getByRole('button', { name: 'Save', exact: true }).click();
    await expect(page.getByText('Studio appearance settings saved.', { exact: true })).toBeVisible();
    await expect(page).toHaveTitle('Acme Workspace');
    await expect(page.locator('.studio-brand-logo').first()).toHaveAttribute('src', f.origin + '/studio-settings/logo');
    expect((await f.request('/studio-settings')).body.data.logo_file).toBe(logo.id);
    const createdFlow = await f.request('/flows', { method: 'POST', token: adminToken, body: {
      name: 'Acme brand acceptance', status: 'active', trigger: 'manual', accountability: 'trigger',
      options: { response: '$last' }, entry: 'result', operations: [{ id: 'result', key: 'result', name: 'Return input',
        type: 'transform', position: { x: 420, y: 140 }, options: { value: '{{ $trigger }}' }, resolve: null, reject: null }],
    } });
    expect(createdFlow.status).toBe(201);
    await page.goto(f.origin + '/#/flows/' + createdFlow.body.data.id);
    await page.getByRole('button', { name: 'Run saved flow', exact: true }).click();
    await expect(page.getByRole('dialog').getByLabel('Trigger payload (JSON)', { exact: true })).toHaveValue(JSON.stringify({ body: { name: 'Acme Workspace' } }, null, 2));
    expect(await page.locator('body').innerText()).not.toMatch(/yuncms|yunsoft/i);
    await page.getByRole('dialog').getByRole('button', { name: 'Cancel', exact: true }).click();
    for (const path of ['appearance', 'features', 'users', 'roles', 'files', 'data-model', 'ai', 'mcp', 'flows', 'security']) {
      await page.goto(f.origin + '/#/' + path);
      await expect(page.locator('.studio-brand').first()).toHaveAttribute('aria-label', 'Acme Workspace');
      await expect(page.locator('a[href*="yunsoft.com"], a[href*="Yunsoft-Software"]')).toHaveCount(0);
      expect(await page.locator('body').innerText()).not.toMatch(/yuncms|yunsoft/i);
    }
    for (const width of widths) {
      await page.setViewportSize({ width, height: width < 600 ? 844 : 1000 });
      for (const theme of ['light', 'dark']) {
        expect((await f.request('/studio-settings', { method: 'PATCH', token: adminToken, body: { theme } })).status).toBe(200);
        await page.goto(f.origin + '/?white_label_theme=' + theme + '&width=' + width + '#/appearance');
        await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
        await expect(page.getByLabel('Brand name', { exact: true })).toHaveValue('Acme Workspace');
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
        await page.screenshot({ path: testInfo.outputPath(`premium-appearance-${theme}-${width}.png`), fullPage: true });
      }
    }
    const anonymous = await browser.newContext({ viewport: { width: 390, height: 844 } }); contexts.push(anonymous);
    const login = await anonymous.newPage(), vendorRequests = [];
    login.on('request', request => { if (/^https?:\/\/(?:www\.)?yunsoft\.com\//i.test(request.url())) vendorRequests.push(request.url()); });
    await login.goto(f.origin + '/');
    await expect(login.locator('input[type=email]')).toBeVisible(); await expect(login).toHaveTitle('Acme Workspace');
    expect(await login.locator('body').innerText()).not.toMatch(/yuncms|yunsoft/i);
    await expect(login.locator('a[href*="yunsoft.com"]')).toHaveCount(0);
    await expect(login.locator('link[data-yuncms-favicon]')).toHaveAttribute('href', 'data:,');
    expect(vendorRequests).toEqual([]);
    await login.screenshot({ path: testInfo.outputPath('premium-cold-login-390.png'), fullPage: true });
    for (const action of ['reset', 'verify']) {
      await login.goto(f.origin + '/?auth_action=' + action + '&token=invalid-test-only-token');
      await expect(login.locator('.auth-card .eyebrow')).toHaveText('Acme Workspace Studio');
      expect(await login.locator('body').innerText()).not.toMatch(/yuncms|yunsoft/i);
      await expect(login.locator('a[href*="yunsoft.com"]')).toHaveCount(0);
    }
    const staffContext = await browser.newContext({ viewport: { width: 1280, height: 900 } }); contexts.push(staffContext);
    await staffContext.addInitScript(() => localStorage.setItem('yuncms.studio.locale', 'en'));
    const staff = await staffContext.newPage();
    await staff.goto(f.origin + '/#/appearance');
    await staff.locator('input[type=email]').fill(f.staff.email);
    await staff.locator('input[type=password]').fill(f.password);
    await staff.getByRole('button', { name: 'Sign in', exact: true }).click();
    await expect(staff.locator('.sidebar-account')).toContainText(f.staff.email);
    await staff.goto(f.origin + '/#/appearance');
    await expect(staff.getByLabel('Brand name', { exact: true })).toHaveCount(0);
    await expect(staff.locator('.error-banner')).toHaveText(translate('en', 'features.settingsAdminOnly'));
    await expect(staff.locator('nav .nav-item-child').filter({ hasText: translate('en', 'nav.appearance') })).toHaveCount(0);
    await expect(staff.locator('.premium-upsell')).toHaveCount(0);
    await expect(staff.locator('.studio-brand').first()).toHaveAttribute('aria-label', 'Acme Workspace');
    await staff.screenshot({ path: testInfo.outputPath('premium-staff-permission-1280.png'), fullPage: true });
    await page.goto(f.origin + '/#/appearance');
    const longName = 'Acme Türkçe 日本語 Workspace '.repeat(5).slice(0, 100);
    await page.getByLabel('Brand name', { exact: true }).fill(longName);
    await page.locator('.brand-asset-picker').first().getByRole('button', { name: 'Remove image', exact: true }).click();
    await page.getByRole('form', { name: 'Branding & Appearance', exact: true }).getByRole('button', { name: 'Save', exact: true }).click();
    await expect(page).toHaveTitle(longName.trim());
    await expect(page.locator('.studio-brand-logo')).toHaveCount(0);
    for (const width of widths) {
      await page.setViewportSize({ width, height: width < 600 ? 844 : 1000 });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      expect(await page.locator('.studio-brand-fallback').evaluateAll(elements => elements.every(element => element.getBoundingClientRect().width <= element.parentElement.getBoundingClientRect().width + 1))).toBe(true);
      await page.screenshot({ path: testInfo.outputPath(`premium-long-brand-${width}.png`), fullPage: true });
      if ([320, 820, 1024].includes(width)) {
        const menu = page.getByRole('button', { name: 'Open menu', exact: true });
        const bounds = await page.getByRole('main').boundingBox();
        await menu.click();
        const drawer = page.getByRole('dialog', { name: 'Studio sections', exact: true });
        const close = drawer.getByRole('button', { name: 'Close menu', exact: true });
        await expect(close).toBeFocused();
        await expect(drawer.locator('.sidebar-support-links')).toBeHidden();
        expect(await drawer.locator('.sidebar-footer').evaluate(element => {
          const probe = document.createElement('span'); probe.style.color = 'var(--ui-border)'; element.append(probe);
          const matches = getComputedStyle(element).borderTopColor === getComputedStyle(probe).color;
          probe.remove(); return matches;
        })).toBe(true);
        expect(await page.getByRole('main').boundingBox()).toEqual(bounds);
        await page.keyboard.press('Shift+Tab'); await expect(drawer.getByRole('button', { name: 'Sign out', exact: true })).toBeFocused();
        await page.keyboard.press('Tab'); await expect(close).toBeFocused();
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
        await page.screenshot({ path: testInfo.outputPath(`premium-long-brand-menu-${width}.png`), fullPage: true });
        await page.keyboard.press('Escape'); await expect(drawer).toHaveCount(0); await expect(menu).toBeFocused();
      }
    }
    expect((await f.request('/features/whiteLabel', { method: 'PATCH', token: adminToken, body: { enabled: false } })).status).toBe(200);
    await login.goto(f.origin + '/'); await expect(login.locator('.studio-brand[href="https://yunsoft.com"]').first()).toBeVisible();
    await expect(login).toHaveTitle('YunCMS Studio');
    expect((await f.request('/studio-settings/logo')).status).toBe(404);
    accepted = true;
  } finally { for (const context of contexts) await context.close(); await f.close({ preserve: !accepted }); }
});
