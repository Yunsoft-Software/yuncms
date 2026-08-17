import assert from 'node:assert/strict';
import test from 'node:test';

import { createSystemAccountability } from '../src/accountability.js';
import { FileReconciliationService } from '../src/services/file-reconciliation-service.js';

function fixture() {
  const deleted = [];
  const now = Date.now();
  const driver = {
    async list() {
      return [
        { key: 'known', size: 10, modifiedAt: new Date(now - 2 * 60 * 60 * 1000) },
        { key: 'old-orphan', size: 20, modifiedAt: new Date(now - 2 * 60 * 60 * 1000) },
        { key: 'recent-orphan', size: 30, modifiedAt: new Date(now - 5 * 60 * 1000) },
      ];
    },
    async delete(key) {
      deleted.push(key);
      return true;
    },
  };
  const database = {
    async query() {
      return [[
        {
          id: 'file-1',
          filename_disk: 'known',
          filename_download: 'known.txt',
          filesize: 10,
          uploaded_at: new Date(now - 3 * 60 * 60 * 1000),
        },
        {
          id: 'file-2',
          filename_disk: 'missing',
          filename_download: 'missing.txt',
          filesize: 12,
          uploaded_at: new Date(now - 3 * 60 * 60 * 1000),
        },
      ], []];
    },
  };
  const storage = { get: () => driver };
  return { database, storage, deleted };
}

test('storage reconciliation reports missing metadata objects and orphan storage objects', async () => {
  const { database, storage, deleted } = fixture();
  const service = new FileReconciliationService({
    accountability: createSystemAccountability(),
    database,
    storage,
  });

  const result = await service.scan({ storage: 'local' });
  assert.deepEqual(result.missingObjects.map((entry) => entry.key), ['missing']);
  assert.deepEqual(result.orphanObjects.map((entry) => entry.key), ['old-orphan', 'recent-orphan']);
  assert.deepEqual(deleted, []);
});

test('destructive orphan cleanup deletes only objects older than the age guard', async () => {
  const { database, storage, deleted } = fixture();
  const service = new FileReconciliationService({
    accountability: createSystemAccountability(),
    database,
    storage,
  });

  const result = await service.scan({
    storage: 'local',
    deleteOrphans: true,
    minimumAgeMs: 60 * 60 * 1000,
  });

  assert.deepEqual(result.deletedOrphans, ['old-orphan']);
  assert.deepEqual(deleted, ['old-orphan']);
});
