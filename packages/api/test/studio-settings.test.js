import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createPublicAccountability,
  createServiceRegistry,
  StudioSettingsService,
} from '@yunsoft/yuncms-core';
import { createApp } from '../src/app.js';

class PublicAuthService {
  async resolvePublicAccountability() {
    return createPublicAccountability({ role: 'public-role' });
  }

  async authenticateBearerToken() {
    throw new Error('not used');
  }
}

function settingsDatabase() {
  return {
    async query(sql) {
      if (sql.includes('FROM yuncms_studio_settings')) {
        return [[{
          brand_name: 'YunCMS',
          logo_url: 'https://yunsoft.com/light-logo.png',
          logo_file: null,
          accent_color: '#2563eb',
          theme: 'system',
          default_locale: 'en',
          updated_at: null,
        }], []];
      }
      throw new Error(`Unexpected database query: ${sql}`);
    },
  };
}

async function withServer(operation) {
  const pool = settingsDatabase();
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
