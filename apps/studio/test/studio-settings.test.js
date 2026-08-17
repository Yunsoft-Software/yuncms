import assert from 'node:assert/strict';
import test from 'node:test';

import {
  DEFAULT_STUDIO_SETTINGS,
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
    accent_color: 'blue',
    theme: 'neon',
    default_locale: 'de',
  });

  assert.equal(settings.brand_name, DEFAULT_STUDIO_SETTINGS.brand_name);
  assert.equal(settings.logo_url, DEFAULT_STUDIO_SETTINGS.logo_url);
  assert.equal(settings.accent_color, DEFAULT_STUDIO_SETTINGS.accent_color);
  assert.equal(settings.theme, 'system');
  assert.equal(settings.default_locale, 'en');
});

test('custom branding remains the effective branding instead of restoring Yunsoft defaults', () => {
  const settings = normalizeStudioSettings({
    brand_name: 'Acme CMS',
    logo_url: 'https://cdn.example.com/acme.svg',
    accent_color: '#ff5500',
    theme: 'dark',
    default_locale: 'tr',
  });

  assert.equal(settings.brand_name, 'Acme CMS');
  assert.equal(settings.logo_url, 'https://cdn.example.com/acme.svg');
  assert.notEqual(settings.logo_url, DEFAULT_STUDIO_SETTINGS.logo_url);
  assert.equal(resolveStudioLogo(settings, 'light'), 'https://cdn.example.com/acme.svg');
  assert.equal(resolveStudioLogo(settings, 'dark'), 'https://cdn.example.com/acme.svg');
});

test('default Yunsoft branding switches logo by resolved theme', () => {
  assert.equal(resolveStudioLogo(DEFAULT_STUDIO_SETTINGS, 'light'), YUNSOFT_LIGHT_LOGO_URL);
  assert.equal(resolveStudioLogo(DEFAULT_STUDIO_SETTINGS, 'dark'), YUNSOFT_DARK_LOGO_URL);
  assert.notEqual(YUNSOFT_LIGHT_LOGO_URL, YUNSOFT_DARK_LOGO_URL);
});

test('system theme follows the OS preference while explicit themes win', () => {
  assert.equal(resolveTheme('system', false), 'light');
  assert.equal(resolveTheme('system', true), 'dark');
  assert.equal(resolveTheme('light', true), 'light');
  assert.equal(resolveTheme('dark', false), 'dark');
});
