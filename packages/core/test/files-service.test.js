import assert from 'node:assert/strict';
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
