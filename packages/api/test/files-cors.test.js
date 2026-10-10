import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import test from 'node:test';

import {
  createPublicAccountability,
  createServiceRegistry,
  loadConfig,
} from '@yunsoft/yuncms-core';
import { createApp } from '../src/app.js';

const STUDIO_ORIGIN = 'https://studio.example.test';
const FILE_CONTENT = Buffer.from('Hello YunCMS CORS Streaming Media!');
const FILE_SIZE = FILE_CONTENT.byteLength;
const FILE_MODIFIED = new Date('2026-10-10T12:00:00.000Z');
const FILE_VALIDATOR = `"test-cors-file-${FILE_SIZE.toString(16)}-${Math.floor(FILE_MODIFIED.getTime() / 1000).toString(16)}"`;

function createMockFilesService() {
  return class MockFilesService {
    constructor(options = {}) {
      this.accountability = options.accountability;
    }

    async readContentInfo(id) {
      if (id !== 'test-file') {
        const error = new Error('File not found');
        error.code = 'FILE_NOT_FOUND';
        throw error;
      }
      return {
        file: {
          id: 'test-file',
          storage: 'local',
          filename_disk: 'test-file',
          filename_download: 'video.mp4',
          title: 'Video',
          mimetype: 'video/mp4',
          filesize: FILE_SIZE,
          uploaded_by: null,
          uploaded_at: FILE_MODIFIED,
          metadata: null,
        },
        size: FILE_SIZE,
        modifiedAt: FILE_MODIFIED,
        etag: FILE_VALIDATOR,
      };
    }

    async readContentStream(id, { start, end } = {}) {
      const slice = (typeof start === 'number' && typeof end === 'number')
        ? FILE_CONTENT.subarray(start, end + 1)
        : (typeof start === 'number' ? FILE_CONTENT.subarray(start) : FILE_CONTENT);

      return {
        file: {
          id: 'test-file',
          mimetype: 'video/mp4',
          filename_download: 'video.mp4',
        },
        stream: Readable.from([slice]),
        size: FILE_SIZE,
        modifiedAt: FILE_MODIFIED,
        etag: FILE_VALIDATOR,
      };
    }
  };
}

class MockAuthService {
  constructor(options = {}) {
    this.options = options;
  }
  async authenticateBearerToken(token) {
    if (token === 'admin-token') {
      return {
        user: 'admin-user',
        role: 'admin-role',
        admin: true,
        authMethod: 'api_token',
      };
    }
    const error = new Error('Invalid token');
    error.code = 'INVALID_CREDENTIALS';
    throw error;
  }
  async resolvePublicAccountability() {
    return createPublicAccountability();
  }
}

async function withServer(operation) {
  const serviceRegistry = createServiceRegistry({
    AuthService: MockAuthService,
    FilesService: createMockFilesService(),
  });

  const app = createApp({
    pool: { async query() { return [[], []]; } },
    config: loadConfig({
      STUDIO_ORIGIN,
      API_RATE_LIMIT_ENABLED: 'false',
      AUTH_RATE_LIMIT_ENABLED: 'false',
    }),
    serviceRegistry,
    storage: { get() { return {}; } },
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

test('OPTIONS preflight allows HEAD and GET with range/if-range/conditional headers for configured Studio origin', async () => {
  await withServer(async (origin) => {
    // 1. Preflight for GET with range and authorization
    const resGet = await fetch(`${origin}/files/test-file/content`, {
      method: 'OPTIONS',
      headers: {
        origin: STUDIO_ORIGIN,
        'access-control-request-method': 'GET',
        'access-control-request-headers': 'authorization,range,if-range',
      },
    });

    assert.equal(resGet.status, 204);
    assert.equal(resGet.headers.get('access-control-allow-origin'), STUDIO_ORIGIN);
    assert.equal(resGet.headers.get('vary'), 'Origin');

    const allowedMethods = resGet.headers.get('access-control-allow-methods') || '';
    assert.match(allowedMethods, /\bGET\b/);
    assert.match(allowedMethods, /\bHEAD\b/);
    assert.match(allowedMethods, /\bPUT\b/);
    assert.match(allowedMethods, /\bPOST\b/);
    assert.match(allowedMethods, /\bPATCH\b/);
    assert.match(allowedMethods, /\bDELETE\b/);
    assert.match(allowedMethods, /\bOPTIONS\b/);

    const allowedHeaders = resGet.headers.get('access-control-allow-headers') || '';
    assert.match(allowedHeaders, /\brange\b/);
    assert.match(allowedHeaders, /\bif-range\b/);
    assert.match(allowedHeaders, /\bif-none-match\b/);
    assert.match(allowedHeaders, /\bif-modified-since\b/);
    assert.match(allowedHeaders, /\bauthorization\b/);

    const exposedHeaders = resGet.headers.get('access-control-expose-headers') || '';
    assert.match(exposedHeaders, /\betag\b/);
    assert.match(exposedHeaders, /\bcontent-range\b/);
    assert.match(exposedHeaders, /\baccept-ranges\b/);
    assert.match(exposedHeaders, /\blast-modified\b/);

    // 2. Preflight for HEAD with conditional headers
    const resHead = await fetch(`${origin}/files/test-file/content`, {
      method: 'OPTIONS',
      headers: {
        origin: STUDIO_ORIGIN,
        'access-control-request-method': 'HEAD',
        'access-control-request-headers': 'authorization,if-none-match,if-modified-since',
      },
    });

    assert.equal(resHead.status, 204);
    assert.equal(resHead.headers.get('access-control-allow-origin'), STUDIO_ORIGIN);
  });
});

test('OPTIONS preflight does not grant CORS access to wrong or unconfigured origin', async () => {
  await withServer(async (origin) => {
    const response = await fetch(`${origin}/files/test-file/content`, {
      method: 'OPTIONS',
      headers: {
        origin: 'https://attacker.example.test',
        'access-control-request-method': 'GET',
        'access-control-request-headers': 'range',
      },
    });

    assert.equal(response.status, 204);
    assert.equal(response.headers.get('access-control-allow-origin'), null);
    assert.equal(response.headers.get('access-control-allow-methods'), null);
    assert.equal(response.headers.get('access-control-allow-headers'), null);
    assert.equal(response.headers.get('access-control-expose-headers'), null);
  });
});

test('cross-origin GET and HEAD requests from configured origin expose media range metadata to browser', async () => {
  await withServer(async (origin) => {
    // Cross-origin partial range GET
    const resRange = await fetch(`${origin}/files/test-file/content`, {
      headers: {
        origin: STUDIO_ORIGIN,
        Authorization: 'Bearer admin-token',
        Range: 'bytes=0-4',
      },
    });

    assert.equal(resRange.status, 206);
    assert.equal(resRange.headers.get('access-control-allow-origin'), STUDIO_ORIGIN);
    const exposed = resRange.headers.get('access-control-expose-headers') || '';
    assert.match(exposed, /\betag\b/);
    assert.match(exposed, /\bcontent-range\b/);
    assert.match(exposed, /\baccept-ranges\b/);

    assert.equal(resRange.headers.get('accept-ranges'), 'bytes');
    assert.equal(resRange.headers.get('content-range'), `bytes 0-4/${FILE_SIZE}`);
    assert.equal(resRange.headers.get('etag'), FILE_VALIDATOR);
    assert.equal(resRange.headers.get('content-length'), '5');
    assert.equal(await resRange.text(), 'Hello');

    // Cross-origin HEAD request
    const resHead = await fetch(`${origin}/files/test-file/content`, {
      method: 'HEAD',
      headers: {
        origin: STUDIO_ORIGIN,
        Authorization: 'Bearer admin-token',
      },
    });

    assert.equal(resHead.status, 200);
    assert.equal(resHead.headers.get('access-control-allow-origin'), STUDIO_ORIGIN);
    assert.equal(resHead.headers.get('accept-ranges'), 'bytes');
    assert.equal(resHead.headers.get('content-length'), String(FILE_SIZE));
    assert.equal(resHead.headers.get('etag'), FILE_VALIDATOR);
    assert.equal(resHead.headers.get('last-modified'), FILE_MODIFIED.toUTCString());

    // Request from unconfigured origin does not include access-control-allow-origin
    const resUntrusted = await fetch(`${origin}/files/test-file/content`, {
      headers: {
        origin: 'https://attacker.example.test',
        Authorization: 'Bearer admin-token',
        Range: 'bytes=0-4',
      },
    });

    assert.equal(resUntrusted.status, 206);
    assert.equal(resUntrusted.headers.get('access-control-allow-origin'), null);
    assert.equal(resUntrusted.headers.get('access-control-expose-headers'), null);
  });
});
