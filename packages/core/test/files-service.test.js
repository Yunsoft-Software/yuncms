import assert from 'node:assert/strict';
import test from 'node:test';

import { createPublicAccountability, createSystemAccountability } from '../src/accountability.js';
import { FilesService } from '../src/services/files-service.js';

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
          filesize: 3,
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
    contents: Buffer.from('pdf'),
    filenameDownload: 'customer-report.pdf',
    mimetype: 'application/pdf',
  });

  assert.match(storedKey, /^[0-9a-f-]{36}$/i);
  assert.notEqual(storedKey, 'customer-report.pdf');
  assert.equal(insertedParams[2], storedKey);
  assert.equal(file.filename_download, 'customer-report.pdf');
});
