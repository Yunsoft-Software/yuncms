import assert from 'node:assert/strict';
import test from 'node:test';
import { publicSettings } from '../../core/src/services/studio-settings-service.js';
import { effectiveStudioBranding } from '../../core/src/premium/white-label.js';

// HTTP, authentication, storage and image response headers are exercised against
// actual MySQL/Express in test/integration/white-label.test.js.
const row = { brand_name: 'Client', logo_url: 'https://yunsoft.com/light-logo.png', logo_file: 'logo', favicon_file: 'icon',
  accent_color: '#2563eb', theme: 'dark', default_locale: 'tr', public_registration_enabled: 1,
  public_registration_require_email_verification: 1, public_registration_role: 'private-role',
  token: 'not-public', password_hash: 'not-public', updated_at: '2026-11-05' };

test('public Studio settings project only documented display and registration flags', () => {
  assert.deepEqual(Object.keys(publicSettings(row)).sort(), ['brand_name','logo_url','logo_file','favicon_file','accent_color','theme','default_locale','public_registration_enabled','public_registration_require_email_verification','updated_at'].sort());
  assert.equal(publicSettings(row).public_registration_enabled, true);
  assert.equal(publicSettings(row).public_registration_require_email_verification, true);
});
test('effective Community public response cannot expose stored custom branding or private account data', () => {
  const response = { ...publicSettings(row), ...effectiveStudioBranding(row) };
  assert.equal(response.brand_name, 'YunCMS'); assert.equal(response.logo_file, null); assert.equal(response.favicon_file, null);
  for (const key of ['token','password_hash','public_registration_role']) assert.equal(Object.hasOwn(response, key), false);
  assert.equal(response.theme, 'dark'); assert.equal(response.default_locale, 'tr');
});
test('entitled white-label public response contains only effective asset identifiers without vendor artwork', () => {
  const response = { ...publicSettings(row), ...effectiveStudioBranding(row, { enabled: true, available: true, premium: true }) };
  assert.equal(response.brand_name, 'Client'); assert.equal(response.logo_url, null); assert.equal(response.logo_file, 'logo');
  assert.equal(response.white_label_enabled, true); assert.equal(Object.hasOwn(response, 'token'), false);
});
