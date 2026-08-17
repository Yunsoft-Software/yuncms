import assert from 'node:assert/strict';
import test from 'node:test';

import { createAccountability, createPublicAccountability } from '../src/accountability.js';
import { StudioSettingsService } from '../src/services/studio-settings-service.js';

const SETTINGS_ROW = {
  brand_name: 'YunCMS',
  logo_url: 'https://yunsoft.com/light-logo.png',
  accent_color: '#2563eb',
  theme: 'system',
  default_locale: 'en',
  updated_at: null,
};

test('public accountability can read only safe Studio appearance settings', async () => {
  const database = {
    async query(sql) {
      assert.match(sql, /FROM yuncms_studio_settings/);
      return [[SETTINGS_ROW], []];
    },
  };
  const service = new StudioSettingsService({
    database,
    accountability: createPublicAccountability({ role: 'public-role' }),
  });

  assert.deepEqual(await service.readPublic(), SETTINGS_ROW);
});

test('non-admin accountability cannot mutate Studio settings before database access', async () => {
  const database = {
    query() {
      throw new Error('database must not be touched');
    },
  };
  const service = new StudioSettingsService({
    database,
    accountability: createAccountability({ user: 'user-1', role: 'role-1' }),
  });

  await assert.rejects(
    service.updateOne({ theme: 'dark' }),
    (error) => error.code === 'FORBIDDEN',
  );
});

test('administrator updates validate and normalize branding fields', async () => {
  const calls = [];
  const database = {
    async query(sql, params = []) {
      calls.push({ sql, params });
      if (sql.includes('UPDATE yuncms_studio_settings')) return [{ affectedRows: 1 }, []];
      return [[{
        ...SETTINGS_ROW,
        brand_name: 'Acme CMS',
        logo_url: 'https://cdn.example.com/acme.svg',
        accent_color: '#ff5500',
        theme: 'dark',
        default_locale: 'tr',
      }], []];
    },
  };
  const service = new StudioSettingsService({
    database,
    accountability: createAccountability({ user: 'admin-1', role: 'admin-role', admin: true }),
  });

  const result = await service.updateOne({
    brand_name: '  Acme CMS  ',
    logo_url: 'https://cdn.example.com/acme.svg',
    accent_color: '#FF5500',
    theme: 'DARK',
    default_locale: 'TR',
  });

  assert.equal(result.brand_name, 'Acme CMS');
  const update = calls.find(({ sql }) => sql.includes('UPDATE yuncms_studio_settings'));
  assert.deepEqual(update.params.slice(0, -1), [
    'Acme CMS',
    'https://cdn.example.com/acme.svg',
    '#ff5500',
    'dark',
    'tr',
  ]);
});

test('Studio settings reject non-http logo URLs and malformed accent colors', async () => {
  const database = { query() { throw new Error('database must not be touched'); } };
  const service = new StudioSettingsService({
    database,
    accountability: createAccountability({ user: 'admin-1', role: 'admin-role', admin: true }),
  });

  await assert.rejects(
    service.updateOne({ logo_url: 'javascript:alert(1)' }),
    (error) => error.code === 'INVALID_PAYLOAD',
  );
  await assert.rejects(
    service.updateOne({ accent_color: '#12345' }),
    (error) => error.code === 'INVALID_PAYLOAD',
  );
});
