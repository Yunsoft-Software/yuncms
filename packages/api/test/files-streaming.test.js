import assert from 'node:assert/strict';
import http from 'node:http';
import { Readable } from 'node:stream';
import test from 'node:test';

import {
  createAccountability,
  createPublicAccountability,
  createServiceRegistry,
  loadConfig,
} from '@yunsoft/yuncms-core';
import { createApp } from '../src/app.js';

const FILE_CONTENT = Buffer.from('Hello YunCMS Streaming!');
const FILE_SIZE = FILE_CONTENT.byteLength;
const FILE_MODIFIED = new Date('2026-10-10T12:00:00.000Z');
const FILE_VALIDATOR = `"test-file-${FILE_SIZE.toString(16)}-${Math.floor(FILE_MODIFIED.getTime() / 1000).toString(16)}"`;

function createMockFilesService(tracked = {}) {
  return class MockFilesService {
    constructor(options = {}) {
      this.accountability = options.accountability;
    }

    async readContentInfo(id) {
      tracked.readContentInfoCalled = true;
      if (this.accountability?.public && tracked.denyPublic) {
        const error = new Error('Forbidden');
        error.code = 'FORBIDDEN';
        throw error;
      }
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
          filename_download: 'stream.txt',
          title: 'Streaming Test',
          mimetype: 'text/plain',
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
      tracked.readContentStreamCalled = true;
      tracked.lastStreamRange = { start, end };

      if (tracked.streamError) {
        const err = new Error(tracked.streamError.message || 'Stream acquisition failed');
        err.code = tracked.streamError.code || 'FILE_NOT_FOUND';
        throw err;
      }

      if (tracked.errorBeforeHeaders) {
        const errorStream = new Readable({
          read() {
            this.destroy(new Error('Pre-header stream failure'));
          },
          destroy(err, cb) {
            tracked.streamDestroyed = true;
            cb(err);
          },
        });
        return {
          file: {
            id: 'test-file',
            mimetype: 'text/plain',
            filename_download: 'stream.txt',
          },
          stream: errorStream,
          size: FILE_SIZE,
          modifiedAt: FILE_MODIFIED,
          etag: FILE_VALIDATOR,
        };
      }

      const slice = (typeof start === 'number' && typeof end === 'number')
        ? FILE_CONTENT.subarray(start, end + 1)
        : (typeof start === 'number' ? FILE_CONTENT.subarray(start) : FILE_CONTENT);

      let chunkIndex = 0;
      const chunks = [slice.subarray(0, Math.ceil(slice.length / 2)), slice.subarray(Math.ceil(slice.length / 2))];
      const stream = new Readable({
        read() {
          if (tracked.slowStream) {
            setTimeout(() => {
              if (chunkIndex < chunks.length) {
                this.push(chunks[chunkIndex++]);
              } else {
                this.push(null);
              }
            }, 50);
          } else {
            if (chunkIndex < chunks.length) {
              this.push(chunks[chunkIndex++]);
            } else {
              this.push(null);
            }
          }
        },
        destroy(err, cb) {
          tracked.streamDestroyed = true;
          cb(err);
        },
      });

      return {
        file: {
          id: 'test-file',
          mimetype: 'text/plain',
          filename_download: 'stream.txt',
        },
        stream,
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

async function withTestServer(tracked, operation) {
  const serviceRegistry = createServiceRegistry({
    AuthService: MockAuthService,
    FilesService: createMockFilesService(tracked),
  });

  const app = createApp({
    pool: { async query() { return [[], []]; } },
    config: loadConfig({
      API_RATE_LIMIT_ENABLED: 'false',
      AUTH_RATE_LIMIT_ENABLED: 'false',
    }),
    serviceRegistry,
    storage: {
      get() { return {}; },
    },
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

test('HTTP GET /files/:id/content streams full 200 response with correct headers', async () => {
  const tracked = {};
  await withTestServer(tracked, async (origin) => {
    const res = await fetch(`${origin}/files/test-file/content`, {
      headers: { Authorization: 'Bearer admin-token' },
    });

    assert.equal(res.status, 200);
    assert.equal(res.headers.get('accept-ranges'), 'bytes');
    assert.equal(res.headers.get('content-type'), 'text/plain; charset=utf-8');
    assert.equal(res.headers.get('content-length'), String(FILE_SIZE));
    assert.equal(res.headers.get('etag'), FILE_VALIDATOR);
    assert.equal(res.headers.get('last-modified'), FILE_MODIFIED.toUTCString());
    assert.match(res.headers.get('content-disposition') || '', /attachment; filename="stream\.txt"/);

    const body = await res.text();
    assert.equal(body, FILE_CONTENT.toString());
    assert.equal(tracked.readContentStreamCalled, true);
    assert.deepEqual(tracked.lastStreamRange, { start: undefined, end: undefined });
  });
});

test('HTTP GET /files/:id/content streams 206 Partial Content for single valid byte ranges', async () => {
  const tracked = {};
  await withTestServer(tracked, async (origin) => {
    // Explicit start-end: 0-4
    const res1 = await fetch(`${origin}/files/test-file/content`, {
      headers: {
        Authorization: 'Bearer admin-token',
        Range: 'bytes=0-4',
      },
    });
    assert.equal(res1.status, 206);
    assert.equal(res1.headers.get('accept-ranges'), 'bytes');
    assert.equal(res1.headers.get('content-range'), `bytes 0-4/${FILE_SIZE}`);
    assert.equal(res1.headers.get('content-length'), '5');
    assert.equal(await res1.text(), 'Hello');

    // Suffix range: last 10 bytes
    const res2 = await fetch(`${origin}/files/test-file/content`, {
      headers: {
        Authorization: 'Bearer admin-token',
        Range: 'bytes=-10',
      },
    });
    assert.equal(res2.status, 206);
    assert.equal(res2.headers.get('content-range'), `bytes ${FILE_SIZE - 10}-${FILE_SIZE - 1}/${FILE_SIZE}`);
    assert.equal(res2.headers.get('content-length'), '10');
    assert.equal(await res2.text(), FILE_CONTENT.subarray(FILE_SIZE - 10).toString());

    // Open-ended range: from byte 6 to end
    const res3 = await fetch(`${origin}/files/test-file/content`, {
      headers: {
        Authorization: 'Bearer admin-token',
        Range: 'bytes=6-',
      },
    });
    assert.equal(res3.status, 206);
    assert.equal(res3.headers.get('content-range'), `bytes 6-${FILE_SIZE - 1}/${FILE_SIZE}`);
    assert.equal(res3.headers.get('content-length'), String(FILE_SIZE - 6));
    assert.equal(await res3.text(), FILE_CONTENT.subarray(6).toString());

    // Clamped range: 6-99999 clamped to end
    const res4 = await fetch(`${origin}/files/test-file/content`, {
      headers: {
        Authorization: 'Bearer admin-token',
        Range: 'bytes=6-99999',
      },
    });
    assert.equal(res4.status, 206);
    assert.equal(res4.headers.get('content-range'), `bytes 6-${FILE_SIZE - 1}/${FILE_SIZE}`);
    assert.equal(res4.headers.get('content-length'), String(FILE_SIZE - 6));
  });
});

test('HTTP GET /files/:id/content returns 416 with empty body for unsatisfiable ranges', async () => {
  const tracked = {};
  await withTestServer(tracked, async (origin) => {
    const res = await fetch(`${origin}/files/test-file/content`, {
      headers: {
        Authorization: 'Bearer admin-token',
        Range: 'bytes=500-600',
      },
    });

    assert.equal(res.status, 416);
    assert.equal(res.headers.get('accept-ranges'), 'bytes');
    assert.equal(res.headers.get('content-range'), `bytes */${FILE_SIZE}`);
    assert.equal(res.headers.get('content-length'), '0');
    const body = await res.text();
    assert.equal(body, '');
    assert.equal(tracked.readContentStreamCalled, undefined); // readContentStream never called!
  });
});

test('HTTP HEAD /files/:id/content ignores Range and returns full 200 headers without body', async () => {
  const tracked = {};
  await withTestServer(tracked, async (origin) => {
    const res = await fetch(`${origin}/files/test-file/content`, {
      method: 'HEAD',
      headers: {
        Authorization: 'Bearer admin-token',
        Range: 'bytes=0-4', // Range must be ignored on HEAD
      },
    });

    assert.equal(res.status, 200);
    assert.equal(res.headers.get('accept-ranges'), 'bytes');
    assert.equal(res.headers.get('content-length'), String(FILE_SIZE));
    assert.equal(res.headers.get('etag'), FILE_VALIDATOR);
    assert.equal(res.headers.get('last-modified'), FILE_MODIFIED.toUTCString());
    assert.equal(await res.text(), '');
    assert.equal(tracked.readContentStreamCalled, undefined); // Never opened body!
  });
});

test('HTTP GET /files/:id/content honors If-Range conditions according to RFC 9110 section 13.1.5', async () => {
  const tracked = {};
  await withTestServer(tracked, async (origin) => {
    // Exact strong ETag match yields 206
    const resMatch = await fetch(`${origin}/files/test-file/content`, {
      headers: {
        Authorization: 'Bearer admin-token',
        Range: 'bytes=0-4',
        'If-Range': FILE_VALIDATOR,
      },
    });
    assert.equal(resMatch.status, 206);
    assert.equal(await resMatch.text(), 'Hello');

    // Weak ETag MUST yield full 200
    const resWeak = await fetch(`${origin}/files/test-file/content`, {
      headers: {
        Authorization: 'Bearer admin-token',
        Range: 'bytes=0-4',
        'If-Range': `W/${FILE_VALIDATOR}`,
      },
    });
    assert.equal(resWeak.status, 200);
    assert.equal(await resWeak.text(), FILE_CONTENT.toString());

    // Mismatched strong ETag yields full 200
    const resMismatch = await fetch(`${origin}/files/test-file/content`, {
      headers: {
        Authorization: 'Bearer admin-token',
        Range: 'bytes=0-4',
        'If-Range': '"other-etag"',
      },
    });
    assert.equal(resMismatch.status, 200);
    assert.equal(await resMismatch.text(), FILE_CONTENT.toString());

    // Exact Last-Modified second match yields 206
    const resDateMatch = await fetch(`${origin}/files/test-file/content`, {
      headers: {
        Authorization: 'Bearer admin-token',
        Range: 'bytes=0-4',
        'If-Range': FILE_MODIFIED.toUTCString(),
      },
    });
    assert.equal(resDateMatch.status, 206);

    // Mismatched Last-Modified date (1 second earlier) yields full 200 (exact match, not <=)
    const earlierDate = new Date(FILE_MODIFIED.getTime() - 1000).toUTCString();
    const resDateMismatch = await fetch(`${origin}/files/test-file/content`, {
      headers: {
        Authorization: 'Bearer admin-token',
        Range: 'bytes=0-4',
        'If-Range': earlierDate,
      },
    });
    assert.equal(resDateMismatch.status, 200);
    assert.equal(await resDateMismatch.text(), FILE_CONTENT.toString());

    // Malformed non-HTTP dates (ISO string, numeric timestamp, date garbage) MUST yield full 200 per RFC 9110
    const resIsoDate = await fetch(`${origin}/files/test-file/content`, {
      headers: {
        Authorization: 'Bearer admin-token',
        Range: 'bytes=0-4',
        'If-Range': '2026-10-10T12:00:00.000Z',
      },
    });
    assert.equal(resIsoDate.status, 200);
    assert.equal(await resIsoDate.text(), FILE_CONTENT.toString());

    const resNumericDate = await fetch(`${origin}/files/test-file/content`, {
      headers: {
        Authorization: 'Bearer admin-token',
        Range: 'bytes=0-4',
        'If-Range': '1760100000',
      },
    });
    assert.equal(resNumericDate.status, 200);
    assert.equal(await resNumericDate.text(), FILE_CONTENT.toString());

    const resGarbageDate = await fetch(`${origin}/files/test-file/content`, {
      headers: {
        Authorization: 'Bearer admin-token',
        Range: 'bytes=0-4',
        'If-Range': 'invalid-date-format',
      },
    });
    assert.equal(resGarbageDate.status, 200);
    assert.equal(await resGarbageDate.text(), FILE_CONTENT.toString());
  });
});

test('HTTP GET /files/:id/content ignores malformed and multi-range requests and yields full 200', async () => {
  const tracked = {};
  await withTestServer(tracked, async (origin) => {
    // Malformed range
    const resMalformed = await fetch(`${origin}/files/test-file/content`, {
      headers: {
        Authorization: 'Bearer admin-token',
        Range: 'bytes=malformed',
      },
    });
    assert.equal(resMalformed.status, 200);
    assert.equal(await resMalformed.text(), FILE_CONTENT.toString());

    // Multi-range
    const resMulti = await fetch(`${origin}/files/test-file/content`, {
      headers: {
        Authorization: 'Bearer admin-token',
        Range: 'bytes=0-2,5-8',
      },
    });
    assert.equal(resMulti.status, 200);
    assert.equal(await resMulti.text(), FILE_CONTENT.toString());
  });
});

test('HTTP GET /files/:id/content enforces authorization before range parsing or metadata headers', async () => {
  const tracked = { denyPublic: true };
  await withTestServer(tracked, async (origin) => {
    const res = await fetch(`${origin}/files/test-file/content`, {
      headers: { Range: 'bytes=0-4' }, // Anonymous public request when public is denied
    });

    assert.equal(res.status, 403);
    assert.equal(tracked.readContentStreamCalled, undefined);
  });
});

test('HTTP GET /files/:id/content destroys upstream stream when client disconnects prematurely', async () => {
  const tracked = { slowStream: true };
  await withTestServer(tracked, async (origin) => {
    const url = new URL(`${origin}/files/test-file/content`);

    await new Promise((resolve, reject) => {
      const req = http.request(
        {
          hostname: url.hostname,
          port: url.port,
          path: url.pathname,
          method: 'GET',
          headers: { Authorization: 'Bearer admin-token' },
        },
        (res) => {
          res.on('data', () => {
            // Abort client request mid-transfer
            req.destroy();
            setTimeout(resolve, 60);
          });
        },
      );
      req.on('error', () => {
        // Expected client abort error
      });
      req.end();
    });

    assert.equal(tracked.streamDestroyed, true);
  });
});

test('HTTP GET and HEAD /files/:id/content handle conditional 304 and unauthorized boundaries correctly', async () => {
  const tracked = {};
  await withTestServer(tracked, async (origin) => {
    // 1. Positive If-None-Match yields 304 without body, without content-length, without content stream
    const resEtagMatch = await fetch(`${origin}/files/test-file/content`, {
      headers: {
        Authorization: 'Bearer admin-token',
        'If-None-Match': FILE_VALIDATOR,
        'Cache-Control': 'max-age=0',
      },
    });
    assert.equal(resEtagMatch.status, 304);
    assert.equal(resEtagMatch.headers.get('content-length'), null);
    assert.equal(await resEtagMatch.text(), '');
    assert.equal(tracked.readContentStreamCalled, undefined);

    // 2. Positive If-Modified-Since yields 304
    const resModifiedMatch = await fetch(`${origin}/files/test-file/content`, {
      headers: {
        Authorization: 'Bearer admin-token',
        'If-Modified-Since': FILE_MODIFIED.toUTCString(),
        'Cache-Control': 'max-age=0',
      },
    });
    assert.equal(resModifiedMatch.status, 304);
    assert.equal(resModifiedMatch.headers.get('content-length'), null);
    assert.equal(await resModifiedMatch.text(), '');
    assert.equal(tracked.readContentStreamCalled, undefined);

    // 3. Stale / mismatched validator yields full 200
    const resMismatch = await fetch(`${origin}/files/test-file/content`, {
      headers: {
        Authorization: 'Bearer admin-token',
        'If-None-Match': '"stale-etag-999"',
        'Cache-Control': 'max-age=0',
      },
    });
    assert.equal(resMismatch.status, 200);
    assert.equal(resMismatch.headers.get('content-length'), String(FILE_SIZE));
    assert.equal(await resMismatch.text(), FILE_CONTENT.toString());
    assert.equal(tracked.readContentStreamCalled, true);

    // 4. Positive HEAD with If-None-Match yields 304
    tracked.readContentStreamCalled = undefined;
    const resHeadMatch = await fetch(`${origin}/files/test-file/content`, {
      method: 'HEAD',
      headers: {
        Authorization: 'Bearer admin-token',
        'If-None-Match': FILE_VALIDATOR,
        'Cache-Control': 'max-age=0',
      },
    });
    assert.equal(resHeadMatch.status, 304);
    assert.equal(resHeadMatch.headers.get('content-length'), null);
    assert.equal(await resHeadMatch.text(), '');
    assert.equal(tracked.readContentStreamCalled, undefined);

    // 5. Unauthorized caller does NOT get 304 and does NOT leak validators or file headers
    tracked.denyPublic = true;
    const resUnauthorized = await fetch(`${origin}/files/test-file/content`, {
      headers: {
        'If-None-Match': FILE_VALIDATOR,
        'Cache-Control': 'max-age=0',
      },
    });
    assert.equal(resUnauthorized.status, 403);
    assert.notEqual(resUnauthorized.headers.get('etag'), FILE_VALIDATOR);
    assert.equal(resUnauthorized.headers.get('last-modified'), null);
    assert.equal(resUnauthorized.headers.get('content-range'), null);
    assert.equal(resUnauthorized.headers.get('accept-ranges'), null);
    const deniedBody = await resUnauthorized.json();
    assert.equal(deniedBody.errors?.[0]?.code, 'FORBIDDEN');

    // 6. Client no-cache retains full 200 behavior per native req.fresh semantics
    tracked.denyPublic = false;
    const resNoCache = await fetch(`${origin}/files/test-file/content`, {
      headers: {
        Authorization: 'Bearer admin-token',
        'If-None-Match': FILE_VALIDATOR,
        'Cache-Control': 'no-cache',
      },
    });
    assert.equal(resNoCache.status, 200);
    assert.equal(resNoCache.headers.get('content-length'), String(FILE_SIZE));
    assert.equal(await resNoCache.text(), FILE_CONTENT.toString());
  });
});

test('HTTP GET /files/:id/content does not swallow genuine pre-header upstream stream error', async () => {
  const tracked = { errorBeforeHeaders: true };
  await withTestServer(tracked, async (origin) => {
    await assert.rejects(
      fetch(`${origin}/files/test-file/content`, {
        headers: { Authorization: 'Bearer admin-token' },
      }),
      (err) => err.name === 'TypeError' || err.code === 'UND_ERR_SOCKET',
    );
    assert.equal(tracked.streamDestroyed, true);
  });
});

test('HTTP GET /files/:id/content clears representation headers and sends JSON error envelope when readContentStream rejects before pipeline', async () => {
  for (const [code, expectedStatus] of [
    ['FILE_NOT_FOUND', 404],
    ['FORBIDDEN', 403],
    ['INVALID_STREAM', 500],
  ]) {
    const tracked = {
      streamError: { code, message: `Simulated ${code}` },
    };
    await withTestServer(tracked, async (origin) => {
      const res = await fetch(`${origin}/files/test-file/content`, {
        headers: { Authorization: 'Bearer admin-token' },
      });
      assert.equal(res.status, expectedStatus);
      assert.match(res.headers.get('content-type') || '', /application\/json/);
      assert.notEqual(res.headers.get('content-type'), 'text/plain');
      assert.equal(res.headers.get('content-disposition'), null);
      assert.notEqual(res.headers.get('etag'), FILE_VALIDATOR);
      assert.equal(res.headers.get('last-modified'), null);
      assert.equal(res.headers.get('content-range'), null);
      assert.equal(res.headers.get('accept-ranges'), null);

      const json = await res.json();
      assert.equal(json.errors?.[0]?.code, code);
    });
  }
});
