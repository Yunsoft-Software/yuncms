import assert from 'node:assert/strict';
import test from 'node:test';
import { createAccountability, createPublicAccountability, createSystemAccountability } from '../src/accountability.js';
import { compileFieldColumn } from '../src/field-types.js';
import { HookEmitter } from '../src/hooks.js';
import { validateNativeReferenceWrites } from '../src/native-reference-access.js';
import { FilesService } from '../src/services/files-service.js';
import { ItemsService } from '../src/services/items-service.js';
import { withTransaction } from '../src/transaction.js';

const user = '11111111-1111-1111-1111-111111111111';
const other = '22222222-2222-2222-2222-222222222222';
const accountability = createAccountability({ user, role: 'customer' });
const owner = { field: 'owner', type: 'uuid', required: true, schema_metadata: { defaultPreset: 'current_user' } };
const schema = { collections: { yuncms_users: { collection: 'yuncms_users', system: true, metadata: { permissionManaged: true, permissionMode: 'action-only', allowedActions: ['read'] }, fields: { id: { field: 'id', type: 'uuid' } } }, tasks: { collection: 'tasks', primary_key: 'id', fields: { id: { field: 'id', type: 'uuid', readonly: true }, owner, title: { field: 'title', type: 'string' } } } }, relationByManyField: new Map([['tasks.owner', { one_collection: 'yuncms_users', one_field: 'id', metadata: { nativeReference: true } }]]) };

test('own native user references use the bounded self read while foreign references remain forbidden', async () => {
  const calls = [];
  const database = { async query(sql, params) { calls.push({ sql, params }); return [sql.includes('permissions') ? [] : [{ id: user }]]; } };
  const service = { database, accountability, schema, collection: 'tasks' };
  await validateNativeReferenceWrites(service, [['owner', user]]);
  assert.match(calls[0].sql, /WHERE id = \?/); assert.deepEqual(calls[0].params, [user]);
  await assert.rejects(validateNativeReferenceWrites(service, [['owner', other]]), { code: 'FORBIDDEN' });
});

test('current_user is a UUID application default and cannot become a SQL identity default', () => {
  const column = compileFieldColumn({ type: 'uuid', required: true, defaultPreset: 'current_user' });
  assert.equal(column.sql, 'CHAR(36) NOT NULL'); assert.equal(column.schemaMetadata.defaultPreset, 'current_user');
  assert.throws(() => compileFieldColumn({ type: 'string', defaultPreset: 'current_user' }), { code: 'UNSUPPORTED_FIELD_DEFAULT' });
});

test('current_user is assigned on single/bulk creation, is immutable and requires an authenticated actor', async () => {
  const inserts = [];
  const database = {
    async beginTransaction() {}, async commit() {}, async rollback() {},
    async query(sql, params) {
      if (sql.includes('permissions')) return [[{ fields: ['title'], validation: { owner: { _eq: '$CURRENT_USER' } } }]];
      if (sql.startsWith('INSERT')) { inserts.push(params); return [{ affectedRows: 1 }]; }
      return [[{ id: user, owner: user, title: 'Demo' }]];
    },
  };
  const service = new ItemsService('tasks', { database, schema, accountability });
  await service.createOne({ title: 'Demo' });
  await service.createMany([{ title: 'A' }, { title: 'B' }]);
  assert.equal(inserts.length, 3); assert.ok(inserts.every(values => values.includes(user)));
  for (const actor of [accountability, createSystemAccountability()]) {
    const s = new ItemsService('tasks', { database, schema, accountability: actor });
    await assert.rejects(s.createOne({ owner: other }), { code: 'FIELD_READ_ONLY' });
    await assert.rejects(s.updateOne(user, { owner: user }), { code: 'FIELD_READ_ONLY' });
  }
  await assert.rejects(new ItemsService('tasks', { database, schema, accountability: createSystemAccountability() }).createOne({ title: 'No actor' }), { code: 'FORBIDDEN' });
  await assert.rejects(new ItemsService('tasks', { database, schema, accountability: createPublicAccountability() }).createOne({ title: 'No actor' }), { code: 'FORBIDDEN' });
  assert.equal(inserts.length, 3);
});

function filesFixture() {
  const calls = [], inserts = [], blobs = new Set(), emitter = new HookEmitter();
  const database = {
    async beginTransaction() { calls.push('begin'); }, async commit() { calls.push('commit'); }, async rollback() { calls.push('rollback'); },
    async query(sql, params) { calls.push(sql); if (sql.startsWith('INSERT')) inserts.push(params); return sql.startsWith('SELECT') ? [[{ id: params[0], filesize: 7 }]] : [{ affectedRows: 1 }]; },
  };
  const storage = { get() { return { async put(key) { calls.push('put'); blobs.add(key); }, async delete(key) { calls.push('cleanup'); blobs.delete(key); } }; } };
  const service = db => new FilesService({ database: db ?? database, emitter, storage, accountability: createSystemAccountability(), requestId: 'admission' });
  return { calls, inserts, blobs, emitter, database, service, upload: { contents: Buffer.from('content'), filenameDownload: 'file.txt' } };
}

test('files.create admission runs before storage with trusted size and rolls back typed rejection', async () => {
  const f = filesFixture();
  f.emitter.registerFilter('files.create', async (payload, ctx) => {
    assert.equal(ctx.filesize, 7); assert.equal(ctx.requestId, 'admission'); assert.equal(ctx.accountability.system, true);
    assert.deepEqual(ctx.transaction, { managed: true, state: 'active' }); assert.equal(ctx.database, f.database);
    assert.equal(f.calls.includes('put'), false); assert.equal(payload.filenameDownload, 'file.txt');
    await ctx.database.query('UPDATE application_quota SET reserved = reserved + 7');
    throw Object.assign(new Error('quota'), { code: 'QUOTA_REACHED', status: 413 });
  });
  await assert.rejects(f.service().createOne(f.upload), { code: 'QUOTA_REACHED', status: 413 });
  assert.ok(f.calls.includes('rollback')); assert.equal(f.calls.includes('put'), false); assert.equal(f.blobs.size, 0);
});

test('file blobs and actions follow the outer transaction, including commit failures', async () => {
  for (const failure of ['outer', 'commit', 'put', 'insert']) {
    const f = filesFixture(); let actions = 0;
    f.emitter.registerAction('files.create', () => { actions++; });
    if (failure === 'commit') f.database.commit = async () => { throw Error('failure'); };
    if (failure === 'insert') { const query = f.database.query; f.database.query = async (sql, params) => { if (sql.startsWith('INSERT')) throw Error('failure'); return query(sql, params); }; }
    if (failure === 'put') { const get = f.service().storage.get; f.service = db => new FilesService({ database: db ?? f.database, emitter: f.emitter, accountability: createSystemAccountability(), storage: { get() { const driver = get(); return { ...driver, async put(key) { await driver.put(key); throw Error('failure'); } }; } } }); }
    await assert.rejects(withTransaction(f.database, async db => { await f.service(db).createOne(f.upload); assert.equal(actions, 0); if (failure === 'outer') throw Error('failure'); }), /failure/);
    assert.equal(f.blobs.size, 0); assert.equal(actions, 0);
  }
  const f = filesFixture();
  f.emitter.registerFilter('files.create', payload => { payload.filenameDownload = 'forged'; return { storage: 'forged' }; });
  f.emitter.registerAction('files.create', (_payload, ctx) => { assert.deepEqual(ctx.transaction, { managed: true, state: 'committed' }); assert.ok(f.calls.includes('commit')); });
  await f.service().createOne(f.upload); assert.equal(f.blobs.size, 1);
  assert.equal(f.inserts[0][3], 'file.txt'); assert.equal(f.inserts[0][1], 'local'); assert.equal(f.inserts[0][6], 7);
  const insert = f.calls.find(sql => sql.startsWith('INSERT')); assert.ok(insert);
});

test('post-commit file action errors retain committed blobs and rollback cleanup failure retains the original error', async () => {
  const f = filesFixture();
  f.emitter.action = async () => { throw Error('post-commit failure'); };
  await assert.rejects(f.service().createOne(f.upload), /post-commit failure/);
  assert.equal(f.blobs.size, 1); assert.equal(f.calls.includes('rollback'), false);
  const cleanup = filesFixture();
  const service = cleanup.service(); service.storage = { get: () => ({ async put() { throw Error('put failed'); }, async delete() { throw Error('cleanup failed'); } }) };
  await assert.rejects(service.createOne(cleanup.upload), error => error.message === 'put failed' && error.cleanupError.message === 'cleanup failed');
});
