import assert from 'node:assert/strict';
import test from 'node:test';
import { StudioSettingsService, STUDIO_LOCALE_CODES, RolesService, createFeaturePolicy } from '@yunsoft/yuncms-core';
import { createWhiteLabelFixture } from '../helpers/white-label-fixture.mjs';

test('real MySQL/HTTP: official Community branding and explicitly enabled Premium white-label boundaries', {
  skip: process.env.YUNCMS_TEST_MYSQL !== '1', timeout: 120000,
}, async t => {
  const f = await createWhiteLabelFixture(); let accepted = false;
  try {
    const admin = (await f.login(f.admin)).access_token, staff = (await f.login(f.staff)).access_token;
    const patch = (body, token = admin) => f.request('/studio-settings', { method: 'PATCH', token, body });
    const activate = token => f.request('/features/license', { method: 'POST', token: admin, body: { token } });
    const enable = enabled => f.request('/features/whiteLabel', { method: 'PATCH', token: admin, body: { enabled } });
    const service = new StudioSettingsService({ ...f.options, storage: f.storage });
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aX1sAAAAASUVORK5CYII=', 'base64');
    const logo = await f.upload(admin), favicon = await f.upload(admin, { type: 'image/png', contents: png }), textFile = await f.upload(admin, { type: 'text/plain', contents: 'Not an image' });
    await f.database.query('UPDATE yuncms_studio_settings SET brand_name=?,logo_file=?,favicon_file=? WHERE id=1', ['Stored client brand', logo.id, favicon.id]);
    await t.test('anonymous settings reveal safe effective branding and retain configured customer data without a grant', async () => {
      const r = await f.request('/studio-settings'); assert.equal(r.status, 200);
      assert.equal(r.body.data.brand_name, 'YunCMS'); assert.equal(r.body.data.logo_file, null); assert.equal(r.body.data.favicon_file, null);
      assert.equal(r.body.data.premium, false); assert.equal(r.body.data.white_label_enabled, false);
      for (const key of ['token', 'public_registration_role', 'publicKey', 'licenseId', 'domain']) assert.equal(Object.hasOwn(r.body.data, key), false);
      const [[row]] = await f.database.query('SELECT brand_name,logo_file,favicon_file FROM yuncms_studio_settings WHERE id=1');
      assert.deepEqual(row, { brand_name: 'Stored client brand', logo_file: logo.id, favicon_file: favicon.id });
      assert.equal((await f.request('/studio-settings/logo')).status, 404); assert.equal((await f.request('/studio-settings/favicon')).status, 404);
    });
    await t.test('Community administrators cannot replace any branding key, while theme, accent, locale and registration stay editable', async () => {
      for (const body of [{ brand_name: 'Removed' }, { logo_file: null }, { logo_url: 'https://yunsoft.com/dark-logo.png' }, { favicon_file: null }]) {
        const r = await patch(body); assert.equal(r.status, 403); assert.equal(r.body.errors[0].code, 'FEATURE_NOT_LICENSED');
      }
      for (const body of [{ white_label_enabled: true }, { white_label_available: true }, { premium: true }]) assert.equal((await patch(body)).status, 400);
      assert.equal((await patch({ theme: 'dark' }, staff)).status, 403); assert.equal((await patch({ theme: 'dark' }, null)).status, 403);
      assert.equal((await f.request('/studio-settings/admin', { token: staff })).status, 403);
      const r = await patch({ theme: 'dark', accent_color: '#5544aa', public_registration_require_email_verification: true });
      assert.equal(r.status, 200); assert.equal(r.body.data.brand_name, 'YunCMS'); assert.equal(r.body.data.public_registration_require_email_verification, true);
      for (const locale of STUDIO_LOCALE_CODES) assert.equal((await patch({ default_locale: locale })).body.data.default_locale, locale);
      for (const body of [{ accent_color: '#12345' }, { theme: 'invalid' }, { default_locale: 'unknown' }]) assert.equal((await patch(body)).status, 400);
      assert.equal((await patch({ public_registration_enabled: true })).status, 400);
      const adminRole = await new RolesService(f.options).createOne({ name: 'Forbidden registration role', admin: true });
      assert.equal((await patch({ public_registration_role: adminRole.id })).status, 400);
      assert.equal((await patch({ public_registration_role: f.staff.role, public_registration_enabled: true })).status, 200);
      assert.equal((await service.readOne()).public_registration_role, f.staff.role);
      assert.equal(Object.hasOwn((await f.request('/studio-settings')).body.data, 'public_registration_role'), false);
    });
    await t.test('missing and nonboolean signed white-label claims cannot grant branding rights', async () => {
      for (const capabilities of [{ contentHistory: true }, { whiteLabel: 'true' }, { whiteLabel: 1 }, { whiteLabel: null }]) {
        assert.equal((await activate(f.issue(capabilities))).status, 200);
        const r = await enable(true); assert.equal(r.status, 403); assert.equal(r.body.errors[0].code, 'FEATURE_NOT_LICENSED');
        assert.equal((await f.request('/studio-settings')).body.data.white_label_enabled, false);
      }
      assert.equal((await activate(f.issue({ whiteLabel: true }, { allowedHosts: ['wrong.example.test'] }))).status, 400);
      assert.equal((await activate(f.issue() + 'tampered')).status, 400);
    });
    await t.test('a real signed grant remains opt-in and ordinary/public accounts cannot enable it', async () => {
      assert.equal((await activate(f.issue())).status, 200);
      assert.equal((await f.request('/features', { token: admin })).body.data.features.whiteLabel.enabled, false);
      assert.equal((await patch({ brand_name: 'Acme' })).body.errors[0].code, 'FEATURE_DISABLED');
      assert.equal((await f.request('/features/whiteLabel', { method: 'PATCH', token: staff, body: { enabled: true } })).status, 403);
      assert.equal((await f.request('/features/whiteLabel', { method: 'PATCH', body: { enabled: true } })).status, 403);
      assert.equal((await enable(true)).status, 200);
      const r = await patch({ brand_name: '  Acme  ', logo_file: logo.id, favicon_file: favicon.id }); assert.equal(r.status, 200);
      assert.equal(r.body.data.brand_name, 'Acme'); assert.equal(r.body.data.logo_url, null);
      assert.equal(r.body.data.white_label_enabled, true); assert.equal(r.body.data.logo_file, logo.id);
    });
    await t.test('public branding assets use actual storage with sandboxed revalidation and only the configured image', async () => {
      for (const [path, mime] of [['/studio-settings/logo', /image\/svg\+xml/], ['/studio-settings/favicon', /image\/png/]]) {
        const r = await f.request(path); assert.equal(r.status, 200); assert.match(r.headers.get('content-type'), mime);
        assert.equal(r.headers.get('content-security-policy'), 'sandbox'); assert.equal(r.headers.get('cache-control'), 'no-cache, must-revalidate');
        assert.equal(r.headers.get('content-disposition'), 'inline');
        if (path.endsWith('/logo')) assert.match(r.text, /<text x="4" y="26">Acme<\/text>/);
        else assert.deepEqual(r.bytes, png);
      }
      for (const body of [{ logo_url: 'https://example.test/logo.svg' }, { logo_file: textFile.id }, { favicon_file: textFile.id }]) assert.equal((await patch(body)).status, 400);
      assert.equal((await patch({ logo_file: null })).status, 200); assert.equal((await f.request('/studio-settings/logo')).status, 404);
      assert.equal((await patch({ logo_file: logo.id })).status, 200);
    });
    await t.test('disable and license expiry restore official branding without destroying saved custom assets', async () => {
      assert.equal((await enable(false)).status, 200);
      assert.equal((await f.request('/studio-settings')).body.data.brand_name, 'YunCMS'); assert.equal((await f.request('/studio-settings/logo')).status, 404);
      assert.equal((await enable(true)).status, 200); assert.equal((await f.request('/studio-settings')).body.data.brand_name, 'Acme');
      await f.database.query('UPDATE yuncms_license_state SET token=? WHERE id=1', [f.issue({ whiteLabel: true }, { exp: Math.floor(Date.now() / 1000) - 1 })]);
      assert.equal((await f.request('/studio-settings')).body.data.white_label_enabled, false);
      assert.equal((await patch({ favicon_file: null })).status, 403);
      assert.equal((await activate(f.issue())).status, 200); assert.equal((await f.request('/studio-settings')).body.data.favicon_file, favicon.id);
    });
    await t.test('operator deny remains authoritative even for a system-accountable branding service', async () => {
      const restricted = new StudioSettingsService({ ...f.options, storage: f.storage,
        featurePolicy: createFeaturePolicy({ ...f.featureConfig, disabled: ['whiteLabel'] }) });
      assert.equal((await restricted.readPublic()).white_label_enabled, false);
      assert.equal((await restricted.readPublic()).brand_name, 'YunCMS');
      await assert.rejects(restricted.updateOne({ brand_name: 'Operator bypass' }), { code: 'FEATURE_DISABLED' });
      assert.equal((await service.readPublic()).brand_name, 'Acme');
    });
    accepted = true;
  } finally { await f.close({ preserve: !accepted }); }
});
