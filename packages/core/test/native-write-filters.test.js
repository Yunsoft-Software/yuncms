import assert from 'node:assert/strict';
import test from 'node:test';
import { createSystemAccountability, createPublicAccountability } from '../src/accountability.js';
import { HookEmitter } from '../src/hooks.js';
import { UsersService } from '../src/services/users-service.js';
import { CollectionsService } from '../src/services/collections-service.js';
import { FieldsService } from '../src/services/fields-service.js';
import { RelationsService } from '../src/services/relations-service.js';
import { createO2ORelation, deleteO2ORelation } from '../src/o2o-relation.js';
import { deleteM2MJunction } from '../src/m2m-lifecycle.js';
import { filterNativeMutation } from '../src/native-lifecycle.js';

test('veto-only schema hooks cannot mutate the original schema payload', async () => {
  const emitter = new HookEmitter(), payload = { metadata: { label: 'safe' } };
  emitter.registerFilter('schema.collection.create', value => { value.metadata.label = 'changed'; return { collection: 'redirected' }; });
  await filterNativeMutation({ emitter, database: {}, accountability: createSystemAccountability() }, 'schema.collection.create', payload);
  assert.deepEqual(payload, { metadata: { label: 'safe' } });
});

function fixture(event) {
  const calls = [], emitter = new HookEmitter();
  const database = {
    async beginTransaction() { calls.push('BEGIN'); }, async commit() { calls.push('COMMIT'); }, async rollback() { calls.push('ROLLBACK'); }, release() {},
    async getConnection() { return this; },
    async query(sql) {
      calls.push(sql);
      if (sql.includes('GET_LOCK')) return [[{ acquired: 1 }]];
      if (sql.includes('RELEASE_LOCK')) return [[{ released: 1 }]];
      if (sql.includes('FROM yuncms_studio_settings')) return [[{ public_registration_enabled: 1, public_registration_role: 'staff', public_registration_require_email_verification: 0 }]];
      if (sql.includes('FROM yuncms_roles')) return [[{ id: 'staff', admin: 0, public: 0 }]];
      if (sql.includes('FROM yuncms_users')) return [[{ id: 'target', email: 'u@x.com', role: 'staff', status: 'disabled' }]];
      throw new Error(`Unexpected query before rejecting filter: ${sql}`);
    },
  };
  let context;
  emitter.registerFilter(event, (_payload, ctx) => { context = ctx; throw Object.assign(new Error('quota/read-only policy'), { code: 'FORBIDDEN' }); });
  return { calls, context: () => context, options: { database, emitter, accountability: createSystemAccountability(), requestId: 'request' } };
}

for (const [event, run] of [
  ['users.create', s => s.createOne({ email: 'u@x.com', password: 'valid-password' })],
  ['users.update', s => s.updateOne('target', { status: 'active' })],
  ['users.delete', s => s.deleteOne('target')],
]) {
  test(`${event} rejects inside a transaction before persistence`, async () => {
    const f = fixture(event);
    await assert.rejects(run(new UsersService(f.options)), { code: 'FORBIDDEN' });
    assert.equal(f.context().accountability.system, true); assert.equal(f.context().requestId, 'request');
    assert.deepEqual(f.context().transaction, { managed: true, state: 'active' });
    assert.ok(f.calls.includes('ROLLBACK')); assert.equal(f.calls.includes('COMMIT'), false);
    assert.equal(f.calls.some(sql => /^(INSERT|UPDATE|DELETE)/.test(sql)), false);
  });
}
test('public registration uses the same users.create gate and cannot bypass quotas', async () => {
  const f = fixture('users.create'); f.options.accountability = createPublicAccountability();
  await assert.rejects(new UsersService(f.options).registerPublic({ email: 'u@x.com', password: 'valid-password' }), { code: 'FORBIDDEN' });
  assert.equal(f.context().publicRegistration, true); assert.equal(f.context().operation, 'register'); assert.equal(f.context().accountability.public, true);
  assert.equal(f.calls.some(sql => /^INSERT/.test(sql)), false);
});

for (const [event, run] of [
  ['schema.collection.create', o => new CollectionsService(o).createOne({ collection: 'things' })],
  ['schema.collection.update', o => new CollectionsService(o).updateOne('things', { note: 'changed' })],
  ['schema.collection.delete', o => new CollectionsService(o).deleteOne('things', { destructive: true })],
  ['schema.field.create', o => new FieldsService(o).createOne('things', { field: 'label', type: 'string' })],
  ['schema.field.update', o => new FieldsService(o).updateOne('things', 'label', { name: 'Changed' })],
  ['schema.field.update', o => new FieldsService(o).updateSchema('things', 'label', { required: true })],
  ['schema.field.delete', o => new FieldsService(o).deleteOne('things', 'label', { destructive: true })],
  ['schema.relation.create', o => new RelationsService(o).createM2O({ manyCollection: 'things', manyField: 'label', oneCollection: 'others' })],
  ['schema.relation.create', o => new RelationsService(o).createM2M({ junctionCollection: 'links', leftCollection: 'things', rightCollection: 'others' })],
  ['schema.relation.delete', o => new RelationsService(o).deleteM2O('things', 'label')],
  ['schema.relation.create', o => createO2ORelation({ ...o, input: { manyCollection: 'things', manyField: 'label', oneCollection: 'others' } })],
  ['schema.relation.delete', o => deleteO2ORelation({ ...o, manyCollection: 'things', manyField: 'label' })],
  ['schema.relation.delete', o => deleteM2MJunction({ ...o, junctionCollection: 'links', destructive: true })],
]) {
  test(`${event} blocks native schema mutation under the advisory lock`, async () => {
    const f = fixture(event);
    await assert.rejects(run(f.options), { code: 'FORBIDDEN' });
    assert.equal(f.context().accountability.system, true); assert.equal(f.context().requestId, 'request');
    assert.equal(f.calls.some(sql => /^(CREATE|ALTER|DROP|RENAME|INSERT|UPDATE|DELETE)/.test(sql)), false);
    assert.ok(f.calls.some(sql => sql.includes('GET_LOCK'))); assert.ok(f.calls.some(sql => sql.includes('RELEASE_LOCK')));
  });
}
