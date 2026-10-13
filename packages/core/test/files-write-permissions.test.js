import assert from 'node:assert/strict';
import test from 'node:test';
import { createAccountability } from '../src/accountability.js';
import { FilesService } from '../src/services/files-service.js';

const fields = Object.fromEntries(['id', 'title', 'uploaded_by', 'filename_download', 'metadata'].map(field => [field, { field, type: field === 'metadata' ? 'json' : 'string' }]));
const schema = { collections: { yuncms_files: { collection: 'yuncms_files', system: true, metadata: { permissionManaged: true, permissionMode: 'filter-read', allowedActions: ['read', 'update', 'delete'] }, fields } } };

function fixture({ owner = 'B', permission = {}, filterHook = null } = {}) {
  let row = { id: 'file', uploaded_by: owner, title: 'old', filename_download: 'a.txt', metadata: null, storage: 'local', filename_disk: 'disk' };
  const writes = [], removed = [], queries = [];
  const database = {
    async beginTransaction() {}, async commit() {}, async rollback() {},
    async query(sql, params = []) {
      queries.push(sql);
      if (sql.includes('FROM yuncms_permissions')) return [[{ fields: null, filter: { uploaded_by: { _eq: '$CURRENT_USER' } }, validation: null, ...permission }]];
      const scoped = sql.includes('`uploaded_by`');
      if (sql.includes('SELECT') && sql.includes('FROM yuncms_files')) return [[...(row && (!scoped || row.uploaded_by === 'B') ? [{ ...row }] : [])]];
      if (sql.startsWith('UPDATE')) {
        writes.push({ sql, params });
        if (scoped && row.uploaded_by !== 'B') return [{ affectedRows: 0 }];
        row.title = params[0]; return [{ affectedRows: 1 }];
      }
      if (sql.startsWith('DELETE')) {
        writes.push({ sql, params });
        if (scoped && row.uploaded_by !== 'B') return [{ affectedRows: 0 }];
        row = null; return [{ affectedRows: 1 }];
      }
      throw new Error(sql);
    },
  };
  const service = new FilesService({ database, schema, accountability: createAccountability({ user: 'B', role: 'staff' }), storage: { get: () => ({ async delete(key) { removed.push(key); } }) }, emitter: filterHook ? { filter: filterHook, async action() {} } : null });
  return { service, writes, removed, queries, row: () => row };
}

for (const operation of ['update', 'delete']) {
  test(`Files ${operation} denies another owner's file without metadata/storage changes`, async () => {
    const f = fixture({ owner: 'A' });
    await assert.rejects(operation === 'update' ? f.service.updateOne('file', { title: 'new' }) : f.service.deleteOne('file'), { code: 'FILE_NOT_FOUND' });
    assert.equal(f.writes.length, 0); assert.equal(f.removed.length, 0); assert.equal(f.row().title, 'old');
  });
  test(`Files ${operation} keeps the owner filter in the mutation SQL`, async () => {
    const f = fixture();
    await (operation === 'update' ? f.service.updateOne('file', { title: 'new' }) : f.service.deleteOne('file'));
    assert.match(f.writes[0].sql, /WHERE.*`uploaded_by`.*AND id = \?/);
    assert.deepEqual(f.writes[0].params.slice(-2), ['B', 'file']);
  });
  test(`Files ${operation} filter can cancel before all writes`, async () => {
    const f = fixture({ filterHook: async (event, payload, context) => {
      assert.equal(event, `files.${operation}`); assert.equal(context.accountability.user, 'B'); assert.equal(context.key, 'file');
      throw Object.assign(new Error('policy'), { code: 'FORBIDDEN' });
    } });
    await assert.rejects(operation === 'update' ? f.service.updateOne('file', { title: 'new' }) : f.service.deleteOne('file'), { code: 'FORBIDDEN' });
    assert.equal(f.writes.length, 0); assert.equal(f.removed.length, 0);
  });
}
test('Files field allowlist uses native column names including filenameDownload mapping', async () => {
  const f = fixture({ permission: { fields: ['title'] } });
  await assert.rejects(f.service.updateOne('file', { filenameDownload: 'b.txt' }), { code: 'FORBIDDEN_FIELD' });
  assert.equal(f.writes.length, 0);
});
test('Files validates the prospective record before writing', async () => {
  const f = fixture({ permission: { validation: { title: { _eq: 'allowed' } } } });
  await assert.rejects(f.service.updateOne('file', { title: 'denied' }), { code: 'VALIDATION_FAILED' });
  assert.equal(f.writes.length, 0); assert.equal(f.row().title, 'old');
  await f.service.updateOne('file', { title: 'allowed' });
  assert.equal(f.row().title, 'allowed');
  assert.ok(f.queries.some(sql => sql.includes('FOR UPDATE')));
});
