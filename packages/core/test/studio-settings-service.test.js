import assert from 'node:assert/strict';
import test from 'node:test';

import { createAccountability, createPublicAccountability } from '../src/accountability.js';
import { StudioSettingsService } from '../src/services/studio-settings-service.js';

const LOGO_FILE_ID = '123e4567-e89b-42d3-a456-426614174000';
const SETTINGS_ROW = {
  brand_name: 'YunCMS',
  logo_url: 'https://yunsoft.com/light-logo.png',
  logo_file: null,
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

test('administrator can choose an existing image file as Studio logo', async () => {
  const calls = [];
  const database = {
    async query(sql, params = []) {
      calls.push({ sql, params });
      if (sql.includes('SELECT id, mimetype FROM yuncms_files')) {
        return [[{ id: LOGO_FILE_ID, mimetype: 'image/svg+xml' }], []];
      }
      if (sql.includes('UPDATE yuncms_studio_settings')) return [{ affectedRows: 1 }, []];
      if (sql.includes('FROM yuncms_studio_settings')) {
        return [[{ ...SETTINGS_ROW, logo_file: LOGO_FILE_ID, brand_name: 'Acme CMS', theme: 'dark' }], []];
      }
      throw new Error(`Unexpected query: ${sql}`);
    },
  };
  const service = new StudioSettingsService({
    database,
    accountability: createAccountability({ user: 'admin-1', role: 'admin-role', admin: true }),
  });

  const result = await service.updateOne({
    brand_name: '  Acme CMS  ',
    logo_file: LOGO_FILE_ID,
    theme: 'DARK',
  });

  assert.equal(result.logo_file, LOGO_FILE_ID);
  const update = calls.find(({ sql }) => sql.includes('UPDATE yuncms_studio_settings'));
  assert.deepEqual(update.params.slice(0, -1), ['Acme CMS', LOGO_FILE_ID, 'dark']);
});

test('public logo content reads only the configured image through storage', async () => {
  const bytes = Buffer.from('<svg/>');
  const database = {
    async query(sql, params = []) {
      if (sql.includes('FROM yuncms_studio_settings')) {
        return [[{ ...SETTINGS_ROW, logo_file: LOGO_FILE_ID }], []];
      }
      if (sql.includes('FROM yuncms_files')) {
        assert.deepEqual(params, [LOGO_FILE_ID]);
        return [[{
          id: LOGO_FILE_ID,
          storage: 'local',
          filename_disk: LOGO_FILE_ID,
          mimetype: 'image/svg+xml',
          filesize: bytes.length,
        }], []];
      }
      throw new Error(`Unexpected query: ${sql}`);
    },
  };
  const storage = {
    get(name) {
      assert.equal(name, 'local');
      return { async get(key) { assert.equal(key, LOGO_FILE_ID); return bytes; } };
    },
  };
  const service = new StudioSettingsService({
    database,
    storage,
    accountability: createPublicAccountability(),
  });

  const result = await service.readLogoContent();
  assert.equal(result.file.mimetype, 'image/svg+xml');
  assert.equal(result.contents, bytes);
});

test('Studio settings reject external logo URLs, non-image logo files and malformed accent colors', async () => {
  const database = {
    async query(sql) {
      if (sql.includes('SELECT id, mimetype FROM yuncms_files')) {
        return [[{ id: LOGO_FILE_ID, mimetype: 'application/pdf' }], []];
      }
      throw new Error('database must not otherwise be touched');
    },
  };
  const service = new StudioSettingsService({
    database,
    accountability: createAccountability({ user: 'admin-1', role: 'admin-role', admin: true }),
  });

  await assert.rejects(
    service.updateOne({ logo_url: 'https://cdn.example.com/acme.svg' }),
    (error) => error.code === 'INVALID_PAYLOAD',
  );
  await assert.rejects(
    service.updateOne({ logo_file: LOGO_FILE_ID }),
    (error) => error.code === 'INVALID_PAYLOAD',
  );
  await assert.rejects(
    service.updateOne({ accent_color: '#12345' }),
    (error) => error.code === 'INVALID_PAYLOAD',
  );
});
