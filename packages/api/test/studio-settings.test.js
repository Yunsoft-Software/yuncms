import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createPublicAccountability,
  createServiceRegistry,
  StudioSettingsService,
} from '@yunsoft/yuncms-core';
import { createApp } from '../src/app.js';

const LOGO_FILE_ID = '123e4567-e89b-42d3-a456-426614174000';

class PublicAuthService {
  async resolvePublicAccountability() {
    return createPublicAccountability({ role: 'public-role' });
  }

  async authenticateBearerToken() {
    throw new Error('not used');
  }
}

function settingsDatabase({ logoFile = null } = {}) {
  return {
    async query(sql, params = []) {
      if (sql.includes('FROM yuncms_studio_settings')) {
        return [[{
          brand_name: 'YunCMS',
          logo_url: 'https://yunsoft.com/light-logo.png',
          logo_file: logoFile,
          accent_color: '#2563eb',
          theme: 'system',
          default_locale: 'en',
          updated_at: null,
        }], []];
      }
      if (sql.includes('FROM yuncms_files')) {
        assert.deepEqual(params, [LOGO_FILE_ID]);
        return [[{
          id: LOGO_FILE_ID,
          storage: 'local',
          filename_disk: 'branding-logo.svg',
          mimetype: 'image/svg+xml',
          filesize: 6,
        }], []];
      }
      throw new Error(`Unexpected database query: ${sql}`);
    },
  };
}

async function withServer(operation, { logoFile = null, storage = null } = {}) {
  const pool = settingsDatabase({ logoFile });
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
      accent_color: '#2563eb',
      theme: 'system',
      default_locale: 'en',
      updated_at: null,
    });
  });
});

test('anonymous Studio can read only the configured file-backed branding image with sandboxed revalidation', async () => {
  const bytes = Buffer.from('<svg/>');
  const storage = {
    get(name) {
      assert.equal(name, 'local');
      return {
        async get(key) {
          assert.equal(key, 'branding-logo.svg');
          return bytes;
        },
      };
    },
  };

  await withServer(async (origin) => {
    const response = await fetch(`${origin}/studio-settings/logo`);
    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-type') || '', /image\/svg\+xml/);
    assert.equal(response.headers.get('content-security-policy'), 'sandbox');
    assert.equal(response.headers.get('cache-control'), 'no-cache, must-revalidate');
    assert.equal(response.headers.get('content-disposition'), 'inline');
    assert.equal(Buffer.from(await response.arrayBuffer()).toString(), bytes.toString());
  }, { logoFile: LOGO_FILE_ID, storage });
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
