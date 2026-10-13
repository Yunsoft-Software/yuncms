import assert from 'node:assert/strict';
import test from 'node:test';
import { createAccountability, createPublicAccountability, createSystemAccountability } from '../src/accountability.js';
import { RelationsService } from '../src/services/relations-service.js';
import { UsersService } from '../src/services/users-service.js';
import { FilesService } from '../src/services/files-service.js';
import { validateNativeReferenceWrites } from '../src/native-reference-access.js';

const id = '11111111-1111-1111-1111-111111111111';
const accountability = createAccountability({ user: id, role: 'staff' });
const files = { collection: 'yuncms_files', system: true, metadata: { permissionManaged: true, permissionMode: 'filter-read', allowedActions: ['read'] }, fields: Object.fromEntries(['id', 'title', 'uploaded_by', 'filename_disk'].map(field => [field, { field, type: 'string' }])) };
const users = { collection: 'yuncms_users', system: true, metadata: { permissionManaged: true, permissionMode: 'action-only', allowedActions: ['read'] }, fields: Object.fromEntries(['id', 'email', 'password_hash', 'role', 'status'].map(field => [field, { field, type: 'string' }])) };
const schema = { collections: { yuncms_files: files, yuncms_users: users }, relationByManyField: new Map([['tasks.owner', { one_collection: 'yuncms_users', one_field: 'id', metadata: { nativeReference: true } }]]) };
function options({ grant = true, filter = null, rows = [{ id, email: 'u@x.test' }] } = {}) {
  const calls = [];
  const database = { async query(sql, params) {
    calls.push({ sql, params });
    if (sql.includes('yuncms_permissions')) return [grant ? [{ fields: null, filter, validation: null }] : []];
    return [rows];
  } };
  return { database, schema, accountability, storage: {}, calls };
}
for (const target of ['yuncms_roles', 'yuncms_sessions', 'tasks']) {
  test(`native M2O rejects unsupported target ${target} before DB access`, async () => {
    const o = options(); o.accountability = createSystemAccountability();
    await assert.rejects(new RelationsService(o).createNativeM2O({ manyCollection: 'tasks', manyField: 'owner', oneCollection: target }), { code: 'UNSUPPORTED_RELATION_TARGET' });
    assert.equal(o.calls.length, 0);
  });
}
test('native relation management requires schema-manager authority', async () => {
  const o = options(); o.accountability = createPublicAccountability();
  await assert.rejects(new RelationsService(o).createNativeM2O({ manyCollection: 'tasks', manyField: 'owner', oneCollection: 'yuncms_users' }), { code: 'FORBIDDEN' });
  assert.equal(o.calls.length, 0);
});
test('native M2O and M2M reject cascading deletion', async () => {
  const o = options(); o.accountability = createSystemAccountability();
  await assert.rejects(new RelationsService(o).createNativeM2O({ manyCollection: 'tasks', manyField: 'owner', oneCollection: 'yuncms_users', onDelete: 'CASCADE' }), { code: 'INVALID_ON_DELETE' });
  await assert.rejects(new RelationsService(o).createNativeM2M({ junctionCollection: 'links', leftCollection: 'tasks', rightCollection: 'yuncms_files', rightOnDelete: 'CASCADE' }), { code: 'INVALID_ON_DELETE' });
  assert.equal(o.calls.length, 0);
});
test('native M2M requires exactly one approved native endpoint', async () => {
  const o = options(); o.accountability = createSystemAccountability();
  await assert.rejects(new RelationsService(o).createNativeM2M({ junctionCollection: 'links', leftCollection: 'yuncms_users', rightCollection: 'yuncms_files' }), { code: 'UNSUPPORTED_RELATION_TARGET' });
});
test('native user relation lookup requires a read grant', async () => {
  const o = options({ grant: false });
  await assert.rejects(new UsersService(o).readManyForRelation({ fields: ['id'], values: [id] }), { code: 'FORBIDDEN' });
  assert.equal(o.calls.filter(call => !call.sql.includes('yuncms_permissions')).length, 0);
});
test('native relation lookups never allow sensitive user or storage fields', async () => {
  const o = options(); o.accountability = createSystemAccountability();
  await assert.rejects(new UsersService(o).readManyForRelation({ fields: ['password_hash'], values: [id] }), { code: 'INVALID_QUERY' });
  await assert.rejects(new FilesService(o).readManyForRelation({ fields: ['filename_disk'], values: [id] }), { code: 'INVALID_QUERY' });
  assert.equal(o.calls.length, 0);
});
test('native Files relation lookup compiles the row filter with caller identity', async () => {
  const o = options({ filter: { uploaded_by: { _eq: '$CURRENT_USER' } }, rows: [] });
  const result = await new FilesService(o).readManyForRelation({ fields: ['id', 'title'], values: [id] });
  assert.deepEqual(result.data, []);
  const query = o.calls.at(-1); assert.match(query.sql, /`uploaded_by` = \?/); assert.deepEqual(query.params, [id, id, 1]);
});
test('native reference writes deny missing grants, hidden targets and malformed UUIDs', async () => {
  for (const setup of [{ grant: false }, { rows: [] }]) {
    const o = options(setup);
    await assert.rejects(validateNativeReferenceWrites({ ...o, collection: 'tasks' }, [['owner', id]]), { code: 'FORBIDDEN' });
  }
  const o = options();
  await assert.rejects(validateNativeReferenceWrites({ ...o, collection: 'tasks' }, [['owner', 'id OR 1=1']]), { code: 'INVALID_PAYLOAD' });
  assert.equal(o.calls.length, 0);
  await validateNativeReferenceWrites({ ...o, collection: 'tasks' }, [['owner', id]]);
  await validateNativeReferenceWrites({ ...o, collection: 'tasks' }, [['owner', null]]);
});
