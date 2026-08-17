import assert from 'node:assert/strict';
import test from 'node:test';

import { createAccountability } from '../src/accountability.js';
import { FilesService } from '../src/services/files-service.js';

const schema = {
  version: 7,
  collections: {
    yuncms_files: {
      collection: 'yuncms_files',
      system: true,
      metadata: {
        permissionManaged: true,
        permissionMode: 'action-only',
        resource: 'files',
        allowedActions: ['read', 'create', 'update', 'delete'],
      },
      fields: {
        id: { field: 'id', type: 'uuid' },
        filename_download: { field: 'filename_download', type: 'string' },
      },
    },
  },
};

function storage() {
  return { get() { throw new Error('storage should not be reached for metadata list'); } };
}

test('delegated file read uses the same explicit permission engine', async () => {
  const database = {
    async query(sql, params = []) {
      const normalized = sql.replace(/\s+/g, ' ').trim();
      if (normalized.includes('FROM yuncms_permissions') && normalized.includes('WHERE role = ?')) {
        assert.deepEqual(params, ['media-role', 'yuncms_files', 'read']);
        return [[{
          id: 'permission-read',
          role: 'media-role',
          collection: 'yuncms_files',
          action: 'read',
          fields: null,
          filter: null,
          validation: null,
        }], []];
      }
      if (normalized.includes('FROM yuncms_files') && normalized.includes('ORDER BY uploaded_at')) {
        return [[{
          id: 'file-1',
          storage: 'local',
          filename_disk: 'file-1',
          filename_download: 'photo.png',
          title: null,
          mimetype: 'image/png',
          filesize: 12,
          uploaded_by: 'user-1',
          uploaded_at: new Date('2026-08-17T06:00:00Z'),
          metadata: null,
        }], []];
      }
      throw new Error(`Unexpected query: ${normalized}`);
    },
  };
  const service = new FilesService({
    database,
    schema,
    storage: storage(),
    accountability: createAccountability({ user: 'user-1', role: 'media-role' }),
  });

  const files = await service.readMany();
  assert.equal(files.length, 1);
  assert.equal(files[0].filename_download, 'photo.png');
});
