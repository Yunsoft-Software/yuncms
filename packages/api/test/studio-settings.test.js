import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createPublicAccountability,
  createServiceRegistry,
  StudioSettingsService,
} from '@yunsoft/yuncms-core';
import { createApp } from '../src/app.js';

const LOGO_FILE_ID = '123e4567-e89b-42d3-a456-426614174000';
const FAVICON_FILE_ID = '223e4567-e89b-42d3-a456-426614174001';

class PublicAuthService {
  async resolvePublicAccountability() {
    return createPublicAccountability({ role: 'public-role' });
  }

  async authenticateBearerToken() {
    throw new Error('not used');
  }
}

function settingsDatabase({ logoFile = null, faviconFile = null } = {}) {
  return {
    async query(sql, params = []) {
      if (sql.includes('FROM yuncms_studio_settings')) {
        return [[{
          brand_name: 'YunCMS',
          logo_url: 'https://yunsoft.com/light-logo.png',
          logo_file: logoFile,
          favicon_file: faviconFile,
          accent_color: '#2563eb',
          theme: 'system',
          default_locale: 'en',
          updated_at: null,
        }], []];
      }
      if (sql.includes('FROM yuncms_files')) {
        const id = params[0];
        const favicon = id === FAVICON_FILE_ID;
        return [[{
          id,
          storage: 'local',
          filename_disk: favicon ? 'branding-favicon.png' : 'branding-logo.svg',
          mimetype: favicon ? 'image/png' : 'image/svg+xml',
          filesize: 6,
        }], []];
      }
      throw new Error(`Unexpected database query: ${sql}`);
    },
  };
}

async function withServer(operation, { logoFile = null, faviconFile = null, storage = null } = {}) {
  const pool = settingsDatabase({ logoFile, faviconFile });
  const registry = createServiceRegistry({
    AuthService: PublicAuthService,
    StudioSettingsService,
  });
  const app = createApp({
    pool,
    config: {
      server: { studioOrigin: 'http://localhost:3008', trustProxyHops: 0 },
      storage: { maxUploadBytes: 1024 },
      auth: { rateLimit: {} },
    },
    storage,
    serviceRegistry: registry,
    logger: { info() {}, warn() {}, error() {} },
  });
  const server = await new Promise((resolve, reject) => {
    const instance = app.listen(0, '127.0.0.1', () => resolve(instance));
    instance.once('error', reject);
  });
  try {
    const { port } = server.address();
    await operation(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

test('anonymous Studio can read safe display settings before login', async () => {
  await withServer(async (origin) => {
    const response = await fetch(`${origin}/studio-settings`);
    assert.equal(response.status, 200);
    assert.deepEqual((await response.json()).data, {
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
});

function storageFixture() {
  return {
    get(name) {
      assert.equal(name, 'local');
      return {
        async get(key) {
          assert.ok(['branding-logo.svg', 'branding-favicon.png'].includes(key));
          return Buffer.from(key.includes('favicon') ? 'PNG123' : '<svg/>');
        },
      };
    },
  };
}

async function assertPublicImageResponse(response, contentType) {
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type') || '', contentType);
  assert.equal(response.headers.get('content-security-policy'), 'sandbox');
  assert.equal(response.headers.get('cache-control'), 'no-cache, must-revalidate');
  assert.equal(response.headers.get('content-disposition'), 'inline');
}

test('anonymous Studio can read only the configured file-backed logo with sandboxed revalidation', async () => {
  await withServer(async (origin) => {
    const response = await fetch(`${origin}/studio-settings/logo`);
    await assertPublicImageResponse(response, /image\/svg\+xml/);
    assert.equal(Buffer.from(await response.arrayBuffer()).toString(), '<svg/>');
  }, { logoFile: LOGO_FILE_ID, storage: storageFixture() });
});

test('anonymous Studio can read only the configured file-backed favicon with sandboxed revalidation', async () => {
  await withServer(async (origin) => {
    const response = await fetch(`${origin}/studio-settings/favicon`);
    await assertPublicImageResponse(response, /image\/png/);
    assert.equal(Buffer.from(await response.arrayBuffer()).toString(), 'PNG123');
  }, { faviconFile: FAVICON_FILE_ID, storage: storageFixture() });
});

test('anonymous Studio cannot mutate branding settings', async () => {
  await withServer(async (origin) => {
    const response = await fetch(`${origin}/studio-settings`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ theme: 'dark' }),
    });
    assert.equal(response.status, 403);
    const payload = await response.json();
    assert.equal(payload.errors[0].code, 'FORBIDDEN');
  });
});
