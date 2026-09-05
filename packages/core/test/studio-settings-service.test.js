import assert from 'node:assert/strict';
import test from 'node:test';

import { createAccountability, createPublicAccountability } from '../src/accountability.js';
import { StudioSettingsService } from '../src/services/studio-settings-service.js';

const LOGO_FILE_ID = '123e4567-e89b-42d3-a456-426614174000';
const FAVICON_FILE_ID = '223e4567-e89b-42d3-a456-426614174001';
const REGISTRATION_ROLE_ID = '323e4567-e89b-42d3-a456-426614174002';
const SETTINGS_ROW = {
  brand_name: 'YunCMS',
  logo_url: 'https://yunsoft.com/light-logo.png',
  logo_file: null,
  favicon_file: null,
  accent_color: '#2563eb',
  theme: 'system',
  default_locale: 'en',
  public_registration_enabled: 0,
  public_registration_role: null,
  public_registration_require_email_verification: 0,
  updated_at: null,
};

test('public accountability can read only safe Studio settings', async () => {
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

  assert.deepEqual(await service.readPublic(), {
    brand_name: 'YunCMS',
    logo_url: 'https://yunsoft.com/light-logo.png',
    logo_file: null,
    favicon_file: null,
    accent_color: '#2563eb',
    theme: 'system',
    default_locale: 'en',
    public_registration_enabled: false,
    public_registration_require_email_verification: false,
    updated_at: null,
  });
});

test('administrator can read registration role while public settings do not expose it', async () => {
  const database = {
    async query() {
      return [[{
        ...SETTINGS_ROW,
        public_registration_enabled: 1,
        public_registration_role: REGISTRATION_ROLE_ID,
        public_registration_require_email_verification: 1,
      }], []];
    },
  };
  const admin = new StudioSettingsService({
    database,
    accountability: createAccountability({ user: 'admin-1', role: 'admin-role', admin: true }),
  });
  const publicService = new StudioSettingsService({
    database,
    accountability: createPublicAccountability(),
  });

  assert.equal((await admin.readOne()).public_registration_role, REGISTRATION_ROLE_ID);
  assert.equal((await admin.readOne()).public_registration_require_email_verification, true);
  assert.equal((await publicService.readPublic()).public_registration_role, undefined);
  assert.equal((await publicService.readPublic()).public_registration_enabled, true);
  assert.equal((await publicService.readPublic()).public_registration_require_email_verification, true);
});

test('administrator can toggle registration email verification independently', async () => {
  const calls = [];
  const database = {
    async query(sql, params = []) {
      calls.push({ sql, params });
      if (sql.includes('UPDATE yuncms_studio_settings')) return [{ affectedRows: 1 }, []];
      if (sql.includes('FROM yuncms_studio_settings')) {
        return [[{
          ...SETTINGS_ROW,
          public_registration_require_email_verification: 1,
        }], []];
      }
      throw new Error(`Unexpected query: ${sql}`);
    },
  };
  const service = new StudioSettingsService({
    database,
    accountability: createAccountability({ user: 'admin-1', role: 'admin-role', admin: true }),
  });

  const result = await service.updateOne({ public_registration_require_email_verification: true });
  assert.equal(result.public_registration_require_email_verification, true);
  const update = calls.find(({ sql }) => sql.includes('UPDATE yuncms_studio_settings'));
  assert.deepEqual(update.params, [1, 1]);
});

test('registration cannot be enabled without a normal authenticated role', async () => {
  const database = {
    async query(sql, params = []) {
      if (sql.includes('FROM yuncms_studio_settings')) return [[SETTINGS_ROW], []];
      if (sql.includes('FROM yuncms_roles')) {
        return [[{ id: params[0], admin: 1, public: 0 }], []];
      }
      throw new Error(`Unexpected query: ${sql}`);
    },
  };
  const service = new StudioSettingsService({
    database,
    accountability: createAccountability({ user: 'admin-1', role: 'admin-role', admin: true }),
  });

  await assert.rejects(
    service.updateOne({ public_registration_enabled: true }),
    (error) => error.code === 'INVALID_PAYLOAD',
  );
  await assert.rejects(
    service.updateOne({ public_registration_role: REGISTRATION_ROLE_ID }),
    (error) => error.code === 'INVALID_PAYLOAD' && /Administrator roles/.test(error.message),
  );
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

test('administrator can choose existing image files as Studio logo and favicon', async () => {
  const calls = [];
  const database = {
    async query(sql, params = []) {
      calls.push({ sql, params });
      if (sql.includes('SELECT id, mimetype FROM yuncms_files')) {
        return [[{ id: params[0], mimetype: 'image/png' }], []];
      }
      if (sql.includes('UPDATE yuncms_studio_settings')) return [{ affectedRows: 1 }, []];
      if (sql.includes('FROM yuncms_studio_settings')) {
        return [[{
          ...SETTINGS_ROW,
          logo_file: LOGO_FILE_ID,
          favicon_file: FAVICON_FILE_ID,
          brand_name: 'Acme CMS',
          theme: 'dark',
        }], []];
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
    favicon_file: FAVICON_FILE_ID,
    theme: 'DARK',
  });

  assert.equal(result.logo_file, LOGO_FILE_ID);
  assert.equal(result.favicon_file, FAVICON_FILE_ID);
  const update = calls.find(({ sql }) => sql.includes('UPDATE yuncms_studio_settings'));
  assert.deepEqual(update.params.slice(0, -1), ['Acme CMS', LOGO_FILE_ID, FAVICON_FILE_ID, 'dark']);
});

test('Studio locale normalization is case-insensitive and rejects locales not enabled yet', async () => {
  const calls = [];
  const database = {
    async query(sql, params = []) {
      calls.push({ sql, params });
      if (sql.includes('UPDATE yuncms_studio_settings')) return [{ affectedRows: 1 }, []];
      if (sql.includes('FROM yuncms_studio_settings')) {
        return [[{ ...SETTINGS_ROW, default_locale: 'tr' }], []];
      }
      throw new Error(`Unexpected query: ${sql}`);
    },
  };
  const service = new StudioSettingsService({
    database,
    accountability: createAccountability({ user: 'admin-1', role: 'admin-role', admin: true }),
  });

  const result = await service.updateOne({ default_locale: ' TR ' });
  assert.equal(result.default_locale, 'tr');
  const update = calls.find(({ sql }) => sql.includes('UPDATE yuncms_studio_settings'));
  assert.deepEqual(update.params, ['tr', 1]);

  await assert.rejects(
    service.updateOne({ default_locale: 'es' }),
    (error) => error.code === 'INVALID_PAYLOAD' && /en, tr/.test(error.message),
  );
});

function imageAssetFixture(settingKey, fileId) {
  const bytes = Buffer.from('<svg/>');
  const database = {
    async query(sql, params = []) {
      if (sql.includes('FROM yuncms_studio_settings')) {
        return [[{ ...SETTINGS_ROW, [settingKey]: fileId }], []];
      }
      if (sql.includes('FROM yuncms_files')) {
        assert.deepEqual(params, [fileId]);
        return [[{
          id: fileId,
          storage: 'local',
          filename_disk: fileId,
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
      return { async get(key) { assert.equal(key, fileId); return bytes; } };
    },
  };
  return { bytes, database, storage };
}

test('public logo content reads only the configured image through storage', async () => {
  const fixture = imageAssetFixture('logo_file', LOGO_FILE_ID);
  const service = new StudioSettingsService({
    database: fixture.database,
    storage: fixture.storage,
    accountability: createPublicAccountability(),
  });

  const result = await service.readLogoContent();
  assert.equal(result.file.mimetype, 'image/svg+xml');
  assert.equal(result.contents, fixture.bytes);
});

test('public favicon content reads only the configured image through storage', async () => {
  const fixture = imageAssetFixture('favicon_file', FAVICON_FILE_ID);
  const service = new StudioSettingsService({
    database: fixture.database,
    storage: fixture.storage,
    accountability: createPublicAccountability(),
  });

  const result = await service.readFaviconContent();
  assert.equal(result.file.id, FAVICON_FILE_ID);
  assert.equal(result.contents, fixture.bytes);
});

test('Studio settings reject external logo URLs, non-image branding files and malformed accent colors', async () => {
  const database = {
    async query(sql, params = []) {
      if (sql.includes('SELECT id, mimetype FROM yuncms_files')) {
        return [[{ id: params[0], mimetype: 'application/pdf' }], []];
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
    service.updateOne({ favicon_file: FAVICON_FILE_ID }),
    (error) => error.code === 'INVALID_PAYLOAD',
  );
  await assert.rejects(
    service.updateOne({ accent_color: '#12345' }),
    (error) => error.code === 'INVALID_PAYLOAD',
  );
});