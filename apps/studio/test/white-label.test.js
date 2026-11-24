import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { brandStudioMessage } from '../src/premium/white-label.js';
import { translate, DICTIONARIES, hasTranslation } from '../src/localization.js';
import { normalizeStudioSettings, resolveStudioLogo, resolveStudioFavicon, studioDocumentTitle } from '../src/studio-settings.js';
import { formatLicenseSummary } from '../src/license-summary.js';
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
  for (const locale of Object.keys(DICTIONARIES)) for (const key of ['whiteLabel','whiteLabelHint','getPremium','resetAppearance','manageFeatures','default_disabled','brandNameFallback','neutralFavicon','noBrandImage','clearBrandImage','settingsAdminOnly','planPerpetual','planMonthly','planAnnual','planMonths','planTerm','summaryPerpetual','summaryActiveTerm','summaryExpired','summaryReadyDomain','summaryMissingDomain','offerTitle','offerDescription','offerOptIn','offerSkip','offerOpenLink','offerPrivacyNote']) {
    assert.equal(hasTranslation(locale, 'features.' + key), true);
    const message = translate(locale, 'features.' + key); assert.ok(message); assert.notEqual(message, 'features.' + key);
  }
  assert.doesNotMatch(translate('en', 'features.perpetual'), /one payment/i);
  assert.doesNotMatch(translate('tr', 'features.perpetual'), /tek ödeme/i);
});
test('license summary formats monthly, multi-month (3m), annual, perpetual and expired entitlements without vendor leakage', () => {
  const tEn = (key, values) => translate('en', key, values, branding);
  const tTr = (key, values) => translate('tr', key, values);
  assert.equal(formatLicenseSummary(null, { locale: 'en', t: tEn }), '');
  const missingUnconfigured = formatLicenseSummary({ status: 'missing' }, { locale: 'en', t: tEn });
  assert.equal(missingUnconfigured, 'Set AUTH_PUBLIC_URL or STUDIO_ORIGIN to your site URL before activating a signed entitlement token (JWT).');
  assert.doesNotMatch(missingUnconfigured, /yuncms|yunsoft/i);
  const missingReady = formatLicenseSummary({ status: 'missing', configuredDomain: 'cms.example.com' }, { locale: 'en', t: tEn });
  assert.equal(missingReady, 'Installation domain: cms.example.com. Paste the signed entitlement token (JWT), not the short license key.');
  assert.doesNotMatch(missingReady, /yuncms|yunsoft/i);
  assert.equal(formatLicenseSummary({ status: 'missing', configuredDomain: 'ornek.com.tr' }, { locale: 'tr', t: tTr }), 'Kurulum alan adı: ornek.com.tr. Kısa lisans anahtarını değil, imzalı yetki belgesini (JWT) yapıştırın.');
  assert.equal(formatLicenseSummary({ status: 'active', domain: 'example.com', billingModel: 'one_time_perpetual', expiresAt: null }, { locale: 'en', t: tEn }), 'example.com · Perpetual');
  const activeMonthly = formatLicenseSummary({ status: 'active', domain: 'example.com', billingModel: 'monthly_term', periodMonths: 1, expiresAt: '2026-12-15T00:00:00.000Z' }, { locale: 'en', t: tEn });
  assert.match(activeMonthly, /^example\.com · Monthly \(1 month\) · Valid until /);
  assert.doesNotMatch(activeMonthly, /yuncms|yunsoft/i);
  const activeThreeMonthEn = formatLicenseSummary({ status: 'active', domain: 'example.com', billingModel: 'monthly_term', periodMonths: 3, expiresAt: '2027-02-24T00:00:00.000Z' }, { locale: 'en', t: tEn });
  assert.match(activeThreeMonthEn, /^example\.com · Term \(3 months\) · Valid until /);
  assert.doesNotMatch(activeThreeMonthEn, /yuncms|yunsoft/i);
  const activeThreeMonthTr = formatLicenseSummary({ status: 'active', domain: 'ornek.com.tr', billingModel: 'monthly_term', periodMonths: 3, expiresAt: '2027-02-24T00:00:00.000Z' }, { locale: 'tr', t: tTr });
  assert.match(activeThreeMonthTr, /^ornek\.com\.tr · Dönemlik \(3 ay\) · .+ tarihine kadar geçerli$/);
  const activeGenericTerm = formatLicenseSummary({ status: 'active', domain: 'example.com', billingModel: 'monthly_term', periodMonths: null, expiresAt: '2027-02-24T00:00:00.000Z' }, { locale: 'en', t: tEn });
  assert.match(activeGenericTerm, /^example\.com · Term license · Valid until /);
  const activeAnnualTr = formatLicenseSummary({ status: 'active', domain: 'ornek.com.tr', billingModel: 'monthly_term', periodMonths: 12, expiresAt: '2027-11-15T00:00:00.000Z' }, { locale: 'tr', t: tTr });
  assert.match(activeAnnualTr, /^ornek\.com\.tr · Yıllık \(12 ay\) · .+ tarihine kadar geçerli$/);
  const expiredSummary = formatLicenseSummary({ status: 'expired', domain: 'example.com', billingModel: 'monthly_term', periodMonths: 3, expiresAt: '2026-10-01T00:00:00.000Z' }, { locale: 'en', t: tEn });
  assert.match(expiredSummary, /Term \(3 months\) · Expired on .*renewed signed license/);
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
  const features = readFileSync(new URL('../src/screens/FeaturesScreen.jsx', import.meta.url), 'utf8');
  assert.match(features, /formatLicenseSummary\(status\.license,\s*\{\s*locale,\s*t\s*\}\)/);
  assert.match(features, /<textarea aria-label=\{t\('features\.token'\)\}[^>]*placeholder="eyJhbGciOiJFZERTQSIs\.\.\."/);
  assert.match(features, /status\.premiumOffer\?\.url && !settings\.premium && !settings\.white_label_enabled/);
  assert.match(features, /href=\{status\.premiumOffer\.url\}[^>]*rel="noopener noreferrer"/);
});
