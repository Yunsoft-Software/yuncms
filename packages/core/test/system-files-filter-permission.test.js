import assert from 'node:assert/strict';
import test from 'node:test';

import { createPublicAccountability, createSystemAccountability } from '../src/accountability.js';
import { FilesService } from '../src/services/files-service.js';
import { PermissionsService } from '../src/services/permissions-service.js';
import { assertSystemPermissionPayload } from '../src/system-permissions.js';

const filesSchema = {
  collection: 'yuncms_files',
  system: true,
  metadata: {
    permissionManaged: true,
    permissionMode: 'filter-read',
    resource: 'files',
    allowedActions: ['read', 'create', 'update', 'delete'],
  },
  fields: {
    id: { field: 'id', type: 'uuid' },
    title: { field: 'title', type: 'string' },
    uploaded_by: { field: 'uploaded_by', type: 'uuid' },
    mimetype: { field: 'mimetype', type: 'string' },
  },
};

const schema = {
  version: 12,
  collections: { yuncms_files: filesSchema },
};

test('Files system permissions allow only read filters as an advanced rule', () => {
  assert.doesNotThrow(() => assertSystemPermissionPayload(
    filesSchema,
    'read',
    { filter: { title: { _eq: 'public' } } },
  ));
  assert.throws(
    () => assertSystemPermissionPayload(filesSchema, 'read', { fields: ['title'] }),
    (error) => error.code === 'SYSTEM_PERMISSION_ADVANCED_UNSUPPORTED',
  );
  assert.throws(
    () => assertSystemPermissionPayload(filesSchema, 'update', { filter: { title: { _eq: 'public' } } }),
    (error) => error.code === 'SYSTEM_PERMISSION_ADVANCED_UNSUPPORTED',
  );
});

test('administrator can create a filtered Public Files read grant', async () => {
  let inserted = null;
  const database = {
    async query(sql, params = []) {
      const normalized = sql.replace(/\s+/g, ' ').trim();
      if (normalized.startsWith('SELECT id, admin, public FROM yuncms_roles')) {
        return [[{ id: 'public-role', admin: 0, public: 1 }], []];
      }
      if (normalized.startsWith('INSERT INTO yuncms_permissions')) {
        inserted = params;
        return [{ affectedRows: 1 }, []];
      }
      if (normalized.includes('FROM yuncms_permissions WHERE id = ?')) {
        return [[{
          id: inserted[0],
          role: inserted[1],
          collection: inserted[2],
          action: inserted[3],
          fields: inserted[4],
          filter: inserted[5],
          validation: inserted[6],
        }], []];
      }
      throw new Error(`Unexpected query: ${normalized}`);
    },
  };
  const service = new PermissionsService({
    database,
    schema,
    accountability: createSystemAccountability(),
  });

  const filter = { title: { _eq: 'public' } };
  const permission = await service.createOne({
    role: 'public-role',
    collection: 'yuncms_files',
    action: 'read',
    filter,
  });

  assert.deepEqual(permission.filter, filter);
  assert.equal(inserted[4], null);
  assert.equal(inserted[6], null);
});

test('Files content reads enforce the permission row filter before storage access', async () => {
  const queries = [];
  let storageReads = 0;
  const database = {
    async query(sql, params = []) {
      const normalized = sql.replace(/\s+/g, ' ').trim();
      queries.push({ sql: normalized, params });
      if (normalized.includes('FROM yuncms_permissions') && normalized.includes('WHERE role = ?')) {
        return [[{
          id: 'permission-1',
          role: 'public-role',
          collection: 'yuncms_files',
          action: 'read',
          fields: null,
          filter: JSON.stringify({ title: { _eq: 'public' } }),
          validation: null,
        }], []];
      }
      if (normalized.includes('FROM yuncms_files') && normalized.includes('AND id = ?')) {
        assert.match(normalized, /WHERE \(`title` = \?\) AND id = \?/);
        assert.deepEqual(params, ['public', 'file-1']);
        return [[{
          id: 'file-1',
          storage: 'local',
          filename_disk: 'file-1',
          filename_download: 'public.pdf',
          title: 'public',
          mimetype: 'application/pdf',
          filesize: 9,
          uploaded_by: null,
          uploaded_at: new Date(),
          metadata: null,
        }], []];
      }
      throw new Error(`Unexpected query: ${normalized}`);
    },
  };
  const storage = {
    get(name) {
      assert.equal(name, 'local');
      return {
        async get(key) {
          storageReads += 1;
          assert.equal(key, 'file-1');
          return Buffer.from('%PDF-1.7');
        },
      };
    },
  };
  const service = new FilesService({
    accountability: createPublicAccountability({ role: 'public-role' }),
    database,
    schema,
    storage,
  });

  const result = await service.readContent('file-1');
  assert.equal(result.file.title, 'public');
  assert.equal(storageReads, 1);
  assert.equal(queries.filter(({ sql }) => sql.includes('FROM yuncms_permissions')).length, 1);
});

test('Files content outside a read filter is hidden and never reaches storage', async () => {
  let storageReads = 0;
  const database = {
    async query(sql) {
      const normalized = sql.replace(/\s+/g, ' ').trim();
      if (normalized.includes('FROM yuncms_permissions') && normalized.includes('WHERE role = ?')) {
        return [[{
          id: 'permission-1',
          role: 'public-role',
          collection: 'yuncms_files',
          action: 'read',
          fields: null,
          filter: JSON.stringify({ title: { _eq: 'public' } }),
          validation: null,
        }], []];
      }
      if (normalized.includes('FROM yuncms_files')) return [[], []];
      throw new Error(`Unexpected query: ${normalized}`);
    },
  };
  const service = new FilesService({
    accountability: createPublicAccountability({ role: 'public-role' }),
    database,
    schema,
    storage: {
      get() {
        return { async get() { storageReads += 1; } };
      },
    },
  });

  await assert.rejects(
    service.readContent('private-file'),
    (error) => error.code === 'FILE_NOT_FOUND',
  );
  assert.equal(storageReads, 0);
});
