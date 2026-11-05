import assert from 'node:assert/strict';
import test from 'node:test';
import { createAccountability, createPublicAccountability, createSystemAccountability } from '../src/accountability.js';
import { STUDIO_LOCALE_CODES } from '../src/studio-locales.js';
import { assertManager, normalizeBrandName, normalizeLogoUrl, normalizeImageFile, normalizeAccent,
  normalizeTheme, normalizeLocale, normalizeBoolean, normalizeRegistrationRole } from '../src/services/studio-settings-service.js';
import { effectiveStudioBranding } from '../src/premium/white-label.js';

const id = '123e4567-e89b-42d3-a456-426614174000';
test('Studio management admits only explicit administrator or system accountability', () => {
  assert.doesNotThrow(() => assertManager(createSystemAccountability()));
  assert.doesNotThrow(() => assertManager(createAccountability({ user: 'admin', admin: true })));
  for (const accountability of [createPublicAccountability(), createAccountability({ user: 'staff' })]) assert.throws(() => assertManager(accountability), { code: 'FORBIDDEN' });
});
test('brand names are trimmed, required and bounded without HTML interpretation', () => {
  assert.equal(normalizeBrandName('  Client <Studio>  '), 'Client <Studio>');
  for (const value of ['', ' ', null, 'x'.repeat(101)]) assert.throws(() => normalizeBrandName(value), { code: 'INVALID_PAYLOAD' });
});
test('branding image identifiers accept existing UUID shape and explicit clearing', () => {
  assert.equal(normalizeImageFile(id, 'Logo'), id); assert.equal(normalizeImageFile('', 'Logo'), null);
  assert.equal(normalizeImageFile(null, 'Favicon'), null);
  assert.throws(() => normalizeImageFile('../file', 'Logo'), { code: 'INVALID_PAYLOAD' });
});
test('remote logo configuration accepts only official legacy artwork, never arbitrary external URLs', () => {
  assert.equal(normalizeLogoUrl('https://yunsoft.com/light-logo.png'), 'https://yunsoft.com/light-logo.png');
  assert.throws(() => normalizeLogoUrl('https://example.test/brand.svg'), { code: 'INVALID_PAYLOAD' });
});
test('appearance color and theme normalization preserve supported values and reject malformed values', () => {
  assert.equal(normalizeAccent('#AABBCC'), '#aabbcc'); assert.equal(normalizeTheme(' DARK '), 'dark');
  assert.throws(() => normalizeAccent('#12345'), { code: 'INVALID_PAYLOAD' });
  assert.throws(() => normalizeTheme('auto'), { code: 'INVALID_PAYLOAD' });
});
test('every supported locale is canonicalized and unknown locales are rejected', () => {
  for (const locale of STUDIO_LOCALE_CODES) assert.equal(normalizeLocale(' ' + locale.toUpperCase() + ' '), locale);
  assert.throws(() => normalizeLocale('xx-unknown'), { code: 'INVALID_PAYLOAD' });
});
test('registration booleans and role identifiers retain strict native input contracts', () => {
  for (const value of [false, true]) assert.equal(normalizeBoolean(value, 'Enabled'), value);
  for (const value of ['true', 1, null]) assert.throws(() => normalizeBoolean(value, 'Enabled'), { code: 'INVALID_PAYLOAD' });
  assert.equal(normalizeRegistrationRole(id), id); assert.equal(normalizeRegistrationRole(null), null);
  assert.throws(() => normalizeRegistrationRole('administrator'), { code: 'INVALID_PAYLOAD' });
});
test('effective Community branding masks stored customization without modifying it', () => {
  const row = Object.freeze({ brand_name: 'Client', logo_url: 'legacy', logo_file: id, favicon_file: id });
  const result = effectiveStudioBranding(row);
  assert.equal(result.brand_name, 'YunCMS'); assert.equal(result.logo_file, null); assert.equal(result.favicon_file, null);
  assert.equal(row.brand_name, 'Client'); assert.equal(row.logo_file, id);
});
test('white-label presentation requires all trusted booleans and uses a neutral default', () => {
  for (const flags of [{ enabled: true }, { enabled: true, available: true }, { enabled: 'true', available: true, premium: true }]) assert.equal(effectiveStudioBranding({}, flags).white_label_enabled, false);
  const flags = { enabled: true, available: true, premium: true };
  assert.equal(effectiveStudioBranding({ brand_name: 'YunCMS' }, flags).brand_name, 'Studio');
  const result = effectiveStudioBranding({ brand_name: 'Client', logo_file: id }, flags);
  assert.equal(result.brand_name, 'Client'); assert.equal(result.logo_file, id); assert.equal(result.logo_url, null);
});
