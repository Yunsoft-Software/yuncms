import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import test from 'node:test';

import { createPublicAccountability, createSystemAccountability } from '../src/accountability.js';
import {
  FilesService,
  hasKnownMimeSignature,
} from '../src/services/files-service.js';

function storageRegistry(driver) {
  return {
    get(name) {
      assert.equal(name, 'local');
      return driver;
    },
  };
}

test('FilesService rejects public access before touching database or storage', async () => {
  const service = new FilesService({
    accountability: createPublicAccountability(),
    database: { query() { throw new Error('database must not be reached'); } },
    storage: storageRegistry({
      put() { throw new Error('storage must not be reached'); },
      get() {}, delete() {}, stat() {}, getSignedUrl() {},
    }),
  });

  await assert.rejects(service.readMany(), (error) => error.code === 'FORBIDDEN');
});

test('FilesService removes stored object when metadata insert fails', async () => {
  const calls = [];
  const driver = {
    async put(key, contents) {
      calls.push(['put', key, contents.byteLength]);
    },
    async delete(key) {
      calls.push(['delete', key]);
      return true;
    },
    async get() {},
    async stat() {},
    async getSignedUrl() {},
  };
  const database = {
    async query(sql) {
      if (sql.startsWith('INSERT INTO yuncms_files')) {
        const error = new Error('metadata insert failed');
        error.code = 'ER_DUP_ENTRY';
        throw error;
      }
      throw new Error(`Unexpected query: ${sql}`);
    },
  };

  const service = new FilesService({
    accountability: createSystemAccountability(),
    database,
    storage: storageRegistry(driver),
  });

  await assert.rejects(
    service.createOne({
      contents: Buffer.from('content'),
      filenameDownload: 'report.txt',
    }),
    (error) => error.code === 'ER_DUP_ENTRY',
  );

  assert.equal(calls[0][0], 'put');
  assert.equal(calls[1][0], 'delete');
  assert.equal(calls[0][1], calls[1][1]);
});

test('FilesService physical key is generated independently from download filename', async () => {
  let storedKey = null;
  let insertedParams = null;
  const pdfContents = Buffer.from('%PDF-1.7\nbody');
  const driver = {
    async put(key) { storedKey = key; },
    async delete() { return true; },
    async get() {},
    async stat() {},
    async getSignedUrl() {},
  };
  const database = {
    async query(sql, params = []) {
      if (sql.startsWith('INSERT INTO yuncms_files')) {
        insertedParams = params;
        return [{ affectedRows: 1 }, []];
      }
      if (sql.includes('FROM yuncms_files') && sql.includes('WHERE id = ?')) {
        return [[{
          id: params[0],
          storage: 'local',
          filename_disk: storedKey,
          filename_download: 'customer-report.pdf',
          title: null,
          mimetype: 'application/pdf',
          filesize: pdfContents.byteLength,
          uploaded_by: null,
          uploaded_at: new Date(),
          metadata: null,
        }], []];
      }
      throw new Error(`Unexpected query: ${sql}`);
    },
  };

  const service = new FilesService({
    accountability: createSystemAccountability(),
    database,
    storage: storageRegistry(driver),
  });
  const file = await service.createOne({
    contents: pdfContents,
    filenameDownload: 'customer-report.pdf',
    mimetype: 'application/pdf',
  });

  assert.match(storedKey, /^[0-9a-f-]{36}$/i);
  assert.notEqual(storedKey, 'customer-report.pdf');
  assert.equal(insertedParams[2], storedKey);
  assert.equal(file.filename_download, 'customer-report.pdf');
});

test('FilesService rejects spoofed known MIME types before database or storage writes', async () => {
  let storageCalled = false;
  let databaseCalled = false;
  const service = new FilesService({
    accountability: createSystemAccountability(),
    database: {
      async query() {
        databaseCalled = true;
        throw new Error('database must not be reached');
      },
    },
    storage: storageRegistry({
      async put() {
        storageCalled = true;
        throw new Error('storage must not be reached');
      },
      async get() {},
      async delete() {},
      async stat() {},
      async getSignedUrl() {},
    }),
  });

  await assert.rejects(
    service.createOne({
      contents: Buffer.from('not-a-real-png'),
      filenameDownload: 'fake.png',
      mimetype: 'image/png',
    }),
    (error) => error.code === 'FILE_MIME_MISMATCH',
  );
  assert.equal(storageCalled, false);
  assert.equal(databaseCalled, false);
});

test('known MIME signature checks accept valid common file signatures and ignore unknown types', () => {
  assert.equal(hasKnownMimeSignature(Buffer.from('%PDF-1.7'), 'application/pdf'), true);
  assert.equal(
    hasKnownMimeSignature(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), 'image/png'),
    true,
  );
  assert.equal(hasKnownMimeSignature(Buffer.from('plain text'), 'text/plain'), null);
});

test('FilesService readContentInfo and readContentStream reject forbidden access before database or storage', async () => {
  let dbReached = false;
  let storageReached = false;
  const service = new FilesService({
    accountability: createPublicAccountability(),
    database: { query() { dbReached = true; throw new Error('database should not be reached'); } },
    storage: storageRegistry({
      get() { storageReached = true; },
      stat() { storageReached = true; },
      getStream() { storageReached = true; },
    }),
  });

  await assert.rejects(service.readContentInfo('file-1'), (error) => error.code === 'FORBIDDEN');
  await assert.rejects(service.readContentStream('file-1'), (error) => error.code === 'FORBIDDEN');
  assert.equal(dbReached, false);
  assert.equal(storageReached, false);
});

test('FilesService readContentInfo returns metadata without calling get or getStream and includes mtime ms in etag', async () => {
  let statCalled = false;
  let getCalled = false;
  let getStreamCalled = false;
  const modDate = new Date('2026-10-10T10:00:00.123Z');
  const mockFile = {
    id: 'file-123',
    storage: 'local',
    filename_disk: 'disk-123',
    filename_download: 'doc.pdf',
    title: 'Doc',
    mimetype: 'application/pdf',
    filesize: 100,
    uploaded_by: null,
    uploaded_at: modDate,
    metadata: null,
  };
  const driver = {
    async stat(key) {
      assert.equal(key, 'disk-123');
      statCalled = true;
      return { key, size: 100, modifiedAt: modDate };
    },
    async get() { getCalled = true; throw new Error('get must not be called'); },
    async getStream() { getStreamCalled = true; throw new Error('getStream must not be called'); },
  };
  const service = new FilesService({
    accountability: createSystemAccountability(),
    database: {
      async query(sql) {
        if (sql.includes('FROM yuncms_files')) return [[mockFile], []];
        throw new Error(`Unexpected query: ${sql}`);
      },
    },
    storage: storageRegistry(driver),
  });

  const info = await service.readContentInfo('file-123');
  assert.equal(statCalled, true);
  assert.equal(getCalled, false);
  assert.equal(getStreamCalled, false);
  assert.equal(info.size, 100);
  assert.equal(info.file.id, 'file-123');
  assert.equal(info.modifiedAt.getTime(), modDate.getTime());
  // ETag includes actual mtime milliseconds (hex)
  const expectedEtag = `"file-123-${(100).toString(16)}-${modDate.getTime().toString(16)}"`;
  assert.equal(info.etag, expectedEtag);
});

test('FilesService readContentInfo uses valid provider strong etag and omits invalid modified dates', async () => {
  const mockFile = {
    id: 'file-s3',
    storage: 'local',
    filename_disk: 'disk-s3',
    filename_download: 's3.pdf',
    title: null,
    mimetype: 'application/pdf',
    filesize: 50,
    uploaded_by: null,
    uploaded_at: 'invalid-date',
    metadata: null,
  };
  const driver = {
    async stat() {
      return {
        key: 'disk-s3',
        size: 50,
        modifiedAt: 'not-a-valid-date',
        etag: '"provider-strong-etag-123"',
      };
    },
    async get() {},
  };
  const service = new FilesService({
    accountability: createSystemAccountability(),
    database: {
      async query(sql) {
        if (sql.includes('FROM yuncms_files')) return [[mockFile], []];
        throw new Error(`Unexpected query: ${sql}`);
      },
    },
    storage: storageRegistry(driver),
  });

  const info = await service.readContentInfo('file-s3');
  assert.equal(info.etag, '"provider-strong-etag-123"');
  assert.equal(info.modifiedAt, null); // Invalid date normalized to null
});

test('FilesService readContentInfo and readContentStream throw controlled FILE_NOT_FOUND when storage object is missing', async () => {
  const mockFile = {
    id: 'file-missing',
    storage: 'local',
    filename_disk: 'missing-disk',
    filename_download: 'doc.pdf',
    title: null,
    mimetype: 'application/pdf',
    filesize: 10,
    uploaded_by: null,
    uploaded_at: new Date(),
    metadata: null,
  };
  const driver = {
    async stat() { return null; }, // missing storage file
    async get() { return null; },
  };
  const service = new FilesService({
    accountability: createSystemAccountability(),
    database: {
      async query(sql) {
        if (sql.includes('FROM yuncms_files')) return [[mockFile], []];
        throw new Error(`Unexpected query: ${sql}`);
      },
    },
    storage: storageRegistry(driver),
  });

  await assert.rejects(
    service.readContentInfo('file-missing'),
    (error) => error.code === 'FILE_NOT_FOUND',
  );
  await assert.rejects(
    service.readContentStream('file-missing'),
    (error) => error.code === 'FILE_NOT_FOUND',
  );
});

test('FilesService readContentStream validates physical byte bounds', async () => {
  const mockFile = {
    id: 'file-bounds',
    storage: 'local',
    filename_disk: 'disk-bounds',
    filename_download: 'test.bin',
    title: null,
    mimetype: 'application/octet-stream',
    filesize: 50,
    uploaded_by: null,
    uploaded_at: new Date(),
    metadata: null,
  };
  const driver = {
    async stat() { return { size: 50, modifiedAt: new Date() }; },
    async getStream() { return Readable.from([Buffer.alloc(50)]); },
  };
  const service = new FilesService({
    accountability: createSystemAccountability(),
    database: {
      async query(sql) {
        if (sql.includes('FROM yuncms_files')) return [[mockFile], []];
        throw new Error(`Unexpected query: ${sql}`);
      },
    },
    storage: storageRegistry(driver),
  });

  // Negative start
  await assert.rejects(
    service.readContentStream('file-bounds', { start: -1 }),
    (error) => error.code === 'INVALID_RANGE',
  );
  // Start >= size
  await assert.rejects(
    service.readContentStream('file-bounds', { start: 50 }),
    (error) => error.code === 'INVALID_RANGE',
  );
  // End < start
  await assert.rejects(
    service.readContentStream('file-bounds', { start: 20, end: 10 }),
    (error) => error.code === 'INVALID_RANGE',
  );
  // End >= size
  await assert.rejects(
    service.readContentStream('file-bounds', { start: 0, end: 50 }),
    (error) => error.code === 'INVALID_RANGE',
  );
});

test('FilesService readContentStream legacy fallback normalizes Uint8Array to single Buffer stream and handles end-only ranges', async () => {
  const fileBytes = Buffer.from('0123456789abcdefghijklmnopqrstuvwxyz');
  const uint8Contents = new Uint8Array(fileBytes); // Uint8Array return from driver.get
  const mockFile = {
    id: 'file-legacy',
    storage: 'local',
    filename_disk: 'disk-legacy',
    filename_download: 'legacy.bin',
    title: null,
    mimetype: 'application/octet-stream',
    filesize: uint8Contents.byteLength,
    uploaded_by: null,
    uploaded_at: new Date(),
    metadata: null,
  };
  let getCallCount = 0;
  const legacyDriver = {
    async stat() { return { size: uint8Contents.byteLength, modifiedAt: new Date() }; },
    async get(key) {
      assert.equal(key, 'disk-legacy');
      getCallCount += 1;
      return uint8Contents;
    },
  };
  const service = new FilesService({
    accountability: createSystemAccountability(),
    database: {
      async query(sql) {
        if (sql.includes('FROM yuncms_files')) return [[mockFile], []];
        throw new Error(`Unexpected query: ${sql}`);
      },
    },
    storage: storageRegistry(legacyDriver),
  });

  // Full stream: chunks must be Buffer, not numbers in object mode
  const fullResult = await service.readContentStream('file-legacy');
  const fullChunks = [];
  for await (const chunk of fullResult.stream) {
    assert.equal(Buffer.isBuffer(chunk), true, 'Chunk must be a Buffer, not numbers in object mode');
    fullChunks.push(chunk);
  }
  assert.deepEqual(Buffer.concat(fullChunks), fileBytes);
  assert.equal(getCallCount, 1);

  // Subrange stream { start: 10, end: 19 }
  const subResult = await service.readContentStream('file-legacy', { start: 10, end: 19 });
  const subChunks = [];
  for await (const chunk of subResult.stream) {
    assert.equal(Buffer.isBuffer(chunk), true);
    subChunks.push(chunk);
  }
  assert.deepEqual(Buffer.concat(subChunks), fileBytes.subarray(10, 20));
  assert.equal(getCallCount, 2);

  // End-only bounds { end: 3 } must return bytes 0..3
  const endOnlyResult = await service.readContentStream('file-legacy', { end: 3 });
  const endOnlyChunks = [];
  for await (const chunk of endOnlyResult.stream) {
    assert.equal(Buffer.isBuffer(chunk), true);
    endOnlyChunks.push(chunk);
  }
  assert.deepEqual(Buffer.concat(endOnlyChunks), fileBytes.subarray(0, 4));
  assert.equal(getCallCount, 3);
});

test('FilesService readContentStream requires a Node Readable from storage getStream', async () => {
  const mockFile = {
    id: 'file-bad-stream',
    storage: 'local',
    filename_disk: 'disk-bad-stream',
    filename_download: 'bad.bin',
    title: null,
    mimetype: 'application/octet-stream',
    filesize: 10,
    uploaded_by: null,
    uploaded_at: new Date(),
    metadata: null,
  };
  const driverWithObject = {
    async stat() { return { size: 10, modifiedAt: new Date() }; },
    // Returns an object or async iterable that is NOT a Node Readable
    async getStream() {
      return {
        async *[Symbol.asyncIterator]() {
          yield Buffer.from('chunk');
        },
      };
    },
  };
  const service = new FilesService({
    accountability: createSystemAccountability(),
    database: {
      async query(sql) {
        if (sql.includes('FROM yuncms_files')) return [[mockFile], []];
        throw new Error(`Unexpected query: ${sql}`);
      },
    },
    storage: storageRegistry(driverWithObject),
  });

  await assert.rejects(
    service.readContentStream('file-bad-stream'),
    (error) => error.code === 'INVALID_STREAM',
  );
});

test('FilesService readContentInfo rejects invalid provider entity tags (CR/LF, inner quote, weak) and falls back to local ETag', async () => {
  const modDate = new Date('2026-10-10T14:00:00.000Z');
  const mockFile = {
    id: 'file-etag-check',
    storage: 'local',
    filename_disk: 'disk-etag',
    filename_download: 'test.bin',
    title: null,
    mimetype: 'application/octet-stream',
    filesize: 25,
    uploaded_by: null,
    uploaded_at: modDate,
    metadata: null,
  };

  const expectedFallback = `"file-etag-check-${(25).toString(16)}-${modDate.getTime().toString(16)}"`;

  const invalidTags = [
    'W/"weak-tag"',
    'w/"weak-tag"',
    '"tag-with\r\n-crlf"',
    '"tag-with\n-lf"',
    '"tag"with"inner"quote"',
    '"tag with spaces"',
    'unquoted-tag',
    null,
  ];

  for (const invalidTag of invalidTags) {
    const driver = {
      async stat() {
        return {
          key: 'disk-etag',
          size: 25,
          modifiedAt: modDate,
          etag: invalidTag,
        };
      },
    };
    const service = new FilesService({
      accountability: createSystemAccountability(),
      database: {
        async query(sql) {
          if (sql.includes('FROM yuncms_files')) return [[mockFile], []];
          throw new Error(`Unexpected query: ${sql}`);
        },
      },
      storage: storageRegistry(driver),
    });

    const info = await service.readContentInfo('file-etag-check');
    assert.equal(
      info.etag,
      expectedFallback,
      `Expected fallback local ETag for invalid provider ETag: ${JSON.stringify(invalidTag)}`,
    );
  }
});
