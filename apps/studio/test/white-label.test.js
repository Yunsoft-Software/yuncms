import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { brandStudioMessage } from '../src/premium/white-label.js';
import { translate, DICTIONARIES, hasTranslation } from '../src/localization.js';
import { normalizeStudioSettings, resolveStudioLogo, resolveStudioFavicon, studioDocumentTitle } from '../src/studio-settings.js';
import { premiumContactUrl } from '../src/upgrade-link.js';

const branding = { white_label_enabled: true, white_label_available: true, premium: true, brand_name: 'Acme Workspace' };
test('white-label avoids default remote logos, favicons and vendor document titles', () => {
  assert.equal(resolveStudioLogo(branding), ''); assert.equal(resolveStudioFavicon(branding), 'data:,');
  assert.equal(studioDocumentTitle(branding), 'Acme Workspace');
  assert.equal(resolveStudioLogo({ ...branding, logo_file: 'logo' }), '/studio-settings/logo');
  assert.equal(resolveStudioFavicon({ ...branding, favicon_file: 'icon' }), '/studio-settings/favicon');
  assert.equal(studioDocumentTitle({}), 'YunCMS Studio');
});
test('brand flags accept actual server booleans only', () => {
  const result = normalizeStudioSettings({ white_label_enabled: 'true', white_label_available: 1, premium: 'true' });
  assert.equal(result.white_label_enabled, false); assert.equal(result.white_label_available, false); assert.equal(result.premium, false);
});
test('translated UI templates preserve customer values and literal brand-name placeholders', () => {
  assert.equal(brandStudioMessage('YunCMS / Yunsoft', branding), 'Acme Workspace / Acme Workspace');
  assert.equal(brandStudioMessage('YUNCMS / YUNSOFT / YunSoft', branding), 'Acme Workspace / Acme Workspace / Acme Workspace');
  assert.equal(brandStudioMessage('YunCMS', {}), 'YunCMS');
  assert.equal(brandStudioMessage('YunCMS', { ...branding, brand_name: '$&' }), '$&');
  assert.equal(translate('en', 'appearance.copyright', { year: 'Yunsoft customer value' }, branding).includes('Yunsoft customer value'), true);
  assert.equal(translate('en', 'appearance.copyright', { year: 2026 }, { ...branding, brand_name: '{year} Client' }), '© 2026 {year} Client. All rights reserved.');
});
test('white-label and Premium discovery translations exist in all supported languages', () => {
  for (const locale of Object.keys(DICTIONARIES)) for (const key of ['whiteLabel','whiteLabelHint','getPremium','resetAppearance','manageFeatures','default_disabled','brandNameFallback','neutralFavicon','noBrandImage','clearBrandImage','settingsAdminOnly']) {
    assert.equal(hasTranslation(locale, 'features.' + key), true);
    const message = translate(locale, 'features.' + key); assert.ok(message); assert.notEqual(message, 'features.' + key);
  }
});
test('upgrade links point to the bilingual Yunsoft contact pages with the Premium campaign', () => {
  const campaign = '?utm_source=studio&utm_medium=yuncms&utm_campaign=yuncms-premium';
  assert.equal(premiumContactUrl('tr'), 'https://yunsoft.com/tr/iletisim' + campaign);
  for (const locale of ['en', 'de']) assert.equal(premiumContactUrl(locale), 'https://yunsoft.com/contact' + campaign);
});
test('initial Studio document is neutral until verified public branding has loaded', () => {
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  assert.match(html, /<title>Studio<\/title>/); assert.doesNotMatch(html, /https:\/\/yunsoft\.com/);
});
test('global appearance controls require administrator navigation and direct-route access', () => {
  const source = readFileSync(new URL('../src/App.jsx', import.meta.url), 'utf8');
  assert.match(source, /id: 'appearance'[^\n]+adminOnly: true/);
  assert.match(source, /section === 'appearance'\) return session\?\.user\?\.admin\s*\? <AppearanceScreen \/>\s*:\s*<div[^>]+role="alert">\{t\('features.settingsAdminOnly'\)\}/);
});
test('authentication captions and new Flow run examples follow the effective customer brand', () => {
  for (const screen of ['LoginScreen', 'AuthActionScreen']) {
    const source = readFileSync(new URL(`../src/screens/${screen}.jsx`, import.meta.url), 'utf8');
    assert.match(source, /<StudioCaption \/>/);
    assert.doesNotMatch(source, /YunCMS/);
  }
  const brand = readFileSync(new URL('../src/components/StudioBrand.jsx', import.meta.url), 'utf8');
  assert.match(brand, /white_label_enabled \? settings.brand_name : 'YunCMS'/);
  const flows = readFileSync(new URL('../src/screens/FlowsScreen.jsx', import.meta.url), 'utf8');
  assert.match(flows, /name: settings.white_label_enabled \? settings.brand_name : 'YunCMS'/);
});
