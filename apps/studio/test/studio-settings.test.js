import assert from 'node:assert/strict';
import test from 'node:test';

import {
  DEFAULT_STUDIO_SETTINGS,
  STUDIO_LOGO_ASSET_PATH,
  YUNSOFT_DARK_LOGO_URL,
  YUNSOFT_LIGHT_LOGO_URL,
  normalizeStudioSettings,
  resolveStudioLogo,
  resolveTheme,
} from '../src/studio-settings.js';

test('Studio settings normalize unsafe or unsupported appearance values to defaults', () => {
  const settings = normalizeStudioSettings({
    brand_name: '  ',
    logo_url: '',
    logo_file: '',
    accent_color: 'blue',
    theme: 'neon',
    default_locale: 'de',
  });

  assert.equal(settings.brand_name, DEFAULT_STUDIO_SETTINGS.brand_name);
  assert.equal(settings.logo_url, DEFAULT_STUDIO_SETTINGS.logo_url);
  assert.equal(settings.logo_file, null);
  assert.equal(settings.accent_color, DEFAULT_STUDIO_SETTINGS.accent_color);
  assert.equal(settings.theme, 'system');
  assert.equal(settings.default_locale, 'en');
});

test('legacy custom URL branding remains readable until replaced', () => {
  const settings = normalizeStudioSettings({
    brand_name: 'Acme CMS',
    logo_url: 'https://cdn.example.com/acme.svg',
    accent_color: '#ff5500',
    theme: 'dark',
    default_locale: 'tr',
  });

  assert.equal(resolveStudioLogo(settings, 'light'), 'https://cdn.example.com/acme.svg');
  assert.equal(resolveStudioLogo(settings, 'dark'), 'https://cdn.example.com/acme.svg');
});

test('file-backed branding resolves through the dedicated public Studio asset endpoint', () => {
  const settings = normalizeStudioSettings({
    ...DEFAULT_STUDIO_SETTINGS,
    logo_file: '123e4567-e89b-42d3-a456-426614174000',
  });
  assert.equal(resolveStudioLogo(settings, 'light'), STUDIO_LOGO_ASSET_PATH);
  assert.equal(resolveStudioLogo(settings, 'dark'), STUDIO_LOGO_ASSET_PATH);
});

test('default Yunsoft branding uses contrasting artwork for each surface theme', () => {
  assert.equal(resolveStudioLogo(DEFAULT_STUDIO_SETTINGS, 'light'), YUNSOFT_DARK_LOGO_URL);
  assert.equal(resolveStudioLogo(DEFAULT_STUDIO_SETTINGS, 'dark'), YUNSOFT_LIGHT_LOGO_URL);
  assert.notEqual(YUNSOFT_LIGHT_LOGO_URL, YUNSOFT_DARK_LOGO_URL);
});

test('system theme follows the OS preference while explicit themes win', () => {
  assert.equal(resolveTheme('system', false), 'light');
  assert.equal(resolveTheme('system', true), 'dark');
  assert.equal(resolveTheme('light', true), 'light');
  assert.equal(resolveTheme('dark', false), 'dark');
});
