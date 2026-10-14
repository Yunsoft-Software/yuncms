import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
  bootstrapDatabase, createAccountability, createDatabasePool, createSystemAccountability,
  CollectionsService, FieldsService, HookEmitter, ItemsService, loadConfig, LocalStorageDriver,
  createStorageRegistry, RelationsService, RolesService, SchemaCache, UsersService, withTransaction,
} from '@yunsoft/yuncms-core';
import { createO2ORelation, deleteO2ORelation } from '../../packages/core/src/o2o-relation.js';
import { createApp } from '../../packages/api/src/app.js';

const parse = value => typeof value === 'string' ? JSON.parse(value) : value;
test('native unique constraints and additive managed-field upgrades preserve real MySQL data and authorization', {
  skip: process.env.YUNCMS_TEST_MYSQL !== '1', timeout: 120_000,
}, async t => {
  assert.equal(process.env.YUNCMS_TEST_DB_ALLOW_DESTRUCTIVE, '1');
  const config = loadConfig(process.env); assert.match(config.database.database, /(test|ci|dev)/i);
  const pool = createDatabasePool(config.database), system = createSystemAccountability();
  const basic = { database: pool, accountability: system }, suffix = randomBytes(5).toString('hex');
  const cache = new SchemaCache({ versionCheckTtlMs: 0 }), emitter = new HookEmitter();
  const root = await mkdtemp(join(tmpdir(), 'yuncms-unique-'));
  const names = [], roleIds = [], userIds = [];
  let server;
  const collections = new CollectionsService(basic), fields = new FieldsService(basic);
  const make = async label => { const collection = `it_schema_${label}_${suffix}`; names.push(collection); await collections.createOne({ collection }); return collection; };
  const items = collection => new ItemsService(collection, { ...basic, schemaCache: cache, emitter });
  const version = async () => { const [[row]] = await pool.query('SELECT version FROM yuncms_schema_state WHERE id = 1'); return row.version; };
  const rows = async collection => (await pool.query(`SELECT * FROM \`${collection}\` ORDER BY id`))[0];
  const ddl = async collection => Object.values((await pool.query(`SHOW CREATE TABLE \`${collection}\``))[0][0])[1];
  const intercept = fn => ({ async getConnection() {
    const connection = await pool.getConnection();
    return new Proxy(connection, { get(target, key) {
      if (key === 'query') return async (sql, params) => fn(sql, params, () => target.query(sql, params));
      const value = Reflect.get(target, key); return typeof value === 'function' ? value.bind(target) : value;
    } });
  } });
  t.after(async () => {
    if (server) await new Promise(resolve => server.close(resolve));
    for (const collection of names.toReversed()) { await pool.query(`DROP TABLE IF EXISTS \`${collection}\``); await pool.query('DELETE FROM yuncms_relations WHERE many_collection = ? OR one_collection = ?', [collection, collection]); await pool.query('DELETE FROM yuncms_collections WHERE collection = ?', [collection]); }
    for (const id of userIds) await pool.query('DELETE FROM yuncms_users WHERE id = ?', [id]);
    for (const id of roleIds) { await pool.query('DELETE FROM yuncms_permissions WHERE role = ?', [id]); await pool.query('DELETE FROM yuncms_roles WHERE id = ?', [id]); }
    await pool.end(); await rm(root, { recursive: true, force: true });
  });
  await bootstrapDatabase(pool);
  const roles = new RolesService(basic), users = new UsersService(basic);
  const adminRole = await roles.createOne({ name: `Unique admin ${suffix}`, admin: true }); roleIds.push(adminRole.id);
  const staffRole = await roles.createOne({ name: `Unique staff ${suffix}` }); roleIds.push(staffRole.id);
  const password = `Schema-${suffix}-Pass!`;
  const admin = await users.createOne({ email: `schema-admin-${suffix}@example.test`, password, role: adminRole.id }); userIds.push(admin.id);
  const staff = await users.createOne({ email: `schema-staff-${suffix}@example.test`, password, role: staffRole.id }); userIds.push(staff.id);
  const app = createApp({ pool, config, schemaCache: cache, emitter, storage: createStorageRegistry({ local: new LocalStorageDriver({ root }) }), logger: { info() {}, warn() {}, error() {} } });
  server = await new Promise(resolve => { const instance = app.listen(0, '127.0.0.1', () => resolve(instance)); });
  const request = async (path, token, method = 'GET', body) => {
    const response = await fetch(`http://127.0.0.1:${server.address().port}${path}`, { method, headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...(body === undefined ? {} : { 'content-type': 'application/json' }) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    return { status: response.status, body: response.status === 204 ? null : await response.json() };
  };
  const login = async user => { const result = await request('/auth/login', null, 'POST', { email: user.email, password }); assert.equal(result.status, 200); return result.body.data.access_token; };
  const adminToken = await login(admin), staffToken = await login(staff);
  const c = await make('unique');
  await t.test('schema DDL inside a managed application transaction is rejected without committing pending writes', async () => {
    const transactional = await make('transaction'); await fields.createOne(transactional, { field: 'label', type: 'string' });
    const beforeVersion = await version(), beforeDdl = await ddl(transactional);
    for (const migrate of [
      database => new FieldsService({ ...basic, database }).createOne(transactional, { field: 'slug', type: 'string', unique: true }),
      database => new FieldsService({ ...basic, database }).updateSchema(transactional, 'label', { unique: true }),
      database => new CollectionsService({ ...basic, database }).updateOne(transactional, { systemFields: ['created_at'] }),
    ]) {
      await assert.rejects(withTransaction(pool, async database => {
        await database.query(`INSERT INTO \`${transactional}\` (id, label) VALUES (?, ?)`, ['pending', 'must roll back']);
        await migrate(database);
      }), { code: 'INVALID_SCHEMA_PAYLOAD' });
      assert.deepEqual(await rows(transactional), []); assert.equal(await ddl(transactional), beforeDdl); assert.equal(await version(), beforeVersion);
    }
  });
  await t.test('field creation installs a full unique index; HTTP conflicts are sanitized and NULLs remain permitted', async () => {
    const created = await request(`/schema/collections/${c}/fields`, adminToken, 'POST', { field: 'slug', type: 'string', unique: true });
    assert.equal(created.status, 201); assert.equal(parse(created.body.data.schema_metadata).unique, true);
    const [indexes] = await pool.query(`SHOW INDEX FROM \`${c}\` WHERE Column_name = 'slug'`);
    assert.equal(indexes.length, 1); assert.equal(indexes[0].Non_unique, 0); assert.equal(indexes[0].Sub_part, null);
    const first = await request(`/items/${c}`, adminToken, 'POST', { slug: 'private-business-value' }); assert.equal(first.status, 201);
    const duplicate = await request(`/items/${c}`, adminToken, 'POST', { slug: 'PRIVATE-BUSINESS-VALUE' });
    assert.equal(duplicate.status, 409); assert.equal(duplicate.body.errors[0].code, 'DUPLICATE_KEY'); assert.equal(JSON.stringify(duplicate.body).includes('BUSINESS'), false);
    await items(c).createMany([{ slug: null }, { slug: null }]);
    assert.equal((await rows(c)).length, 3);
  });
  await t.test('single, bulk and concurrent writes cannot evade uniqueness; failed batches roll back hooks and earlier records', async () => {
    await fields.createOne(c, { field: 'used_count', type: 'integer', defaultValue: 0 });
    await items(c).createOne({ slug: 'hook-reservation' });
    let actions = 0; const offAction = emitter.registerAction('items.create', () => { actions++; });
    const offFilter = emitter.registerFilter('items.create', async (payload, ctx) => { if (ctx.collection === c) await ctx.database.query(`UPDATE \`${c}\` SET used_count = used_count + 1 WHERE slug = 'hook-reservation'`); return payload; });
    try {
      const before = await rows(c);
      await assert.rejects(items(c).createMany([{ slug: 'batch-new' }, { slug: 'private-business-value' }]), { code: 'ER_DUP_ENTRY' }); assert.deepEqual(await rows(c), before); assert.equal(actions, 0);
      const results = await Promise.all(Array.from({ length: 4 }, () => request(`/items/${c}`, adminToken, 'POST', { slug: 'race' })));
      assert.equal(results.filter(result => result.status === 201).length, 1); assert.equal(results.filter(result => result.status === 409).length, 3);
      assert.equal((await rows(c)).find(row => row.slug === 'hook-reservation').used_count, 1);
      const all = await rows(c), nullable = all.find(row => row.slug === null);
      assert.equal((await request(`/items/${c}/${nullable.id}`, adminToken, 'PATCH', { slug: 'race' })).status, 409);
      assert.equal((await rows(c)).find(row => row.id === nullable.id).slug, null);
    } finally { offFilter(); offAction(); }
  });
  await t.test('duplicate backfill refuses a combined physical migration without changing data, metadata, DDL or schema version', async () => {
    const duplicate = await make('duplicate'); await fields.createOne(duplicate, { field: 'key_value', type: 'string', indexed: true });
    await items(duplicate).createMany([{ key_value: 'Same' }, { key_value: 'same' }]);
    const beforeRows = await rows(duplicate), beforeDdl = await ddl(duplicate), beforeField = await fields.readOne(duplicate, 'key_value'), beforeVersion = await version();
    const result = await request(`/schema/collections/${duplicate}/fields/key_value/schema`, adminToken, 'PATCH', { unique: true, required: true, defaultValue: 'other' });
    assert.equal(result.status, 409); assert.equal(result.body.errors[0].code, 'DUPLICATE_KEY');
    assert.deepEqual(await rows(duplicate), beforeRows); assert.equal(await ddl(duplicate), beforeDdl); assert.deepEqual(await fields.readOne(duplicate, 'key_value'), beforeField); assert.equal(await version(), beforeVersion);
  });
  await t.test('a duplicate arriving after preflight is caught by atomic ALTER without a partial column/default change', async () => {
    const race = await make('ddl_race'); await fields.createOne(race, { field: 'slug', type: 'string' }); await items(race).createOne({ slug: 'late-private-value' });
    const beforeDdl = await ddl(race), beforeField = await fields.readOne(race, 'slug'), beforeVersion = await version(); let injected = false;
    const database = intercept(async (sql, _params, run) => {
      const result = await run();
      if (!injected && sql.startsWith('SELECT 1 AS duplicate')) { injected = true; await items(race).createOne({ slug: 'late-private-value' }); }
      return result;
    });
    await assert.rejects(new FieldsService({ ...basic, database }).updateSchema(race, 'slug', { unique: true, defaultValue: 'new-default' }), error => error.code === 'DUPLICATE_KEY' && !error.message.includes('late-private-value'));
    assert.equal(injected, true); assert.equal(await ddl(race), beforeDdl); assert.deepEqual(await fields.readOne(race, 'slug'), beforeField); assert.equal(await version(), beforeVersion); assert.equal((await rows(race)).length, 2);
  });
  await t.test('successful backfill can be enabled, repeated, downgraded to an ordinary index and disabled without losing rows', async () => {
    const upgrade = await make('backfill'); await fields.createOne(upgrade, { field: 'code', type: 'integer', indexed: true }); await items(upgrade).createMany([{ code: 1 }, { code: 2 }, { code: null }, { code: null }]);
    const before = await rows(upgrade);
    await fields.updateSchema(upgrade, 'code', { unique: true }); await fields.updateSchema(upgrade, 'code', { unique: true });
    await assert.rejects(items(upgrade).createOne({ code: 1 }), { code: 'ER_DUP_ENTRY' });
    await fields.updateSchema(upgrade, 'code', { unique: false });
    const [ordinary] = await pool.query(`SHOW INDEX FROM \`${upgrade}\` WHERE Column_name = 'code'`); assert.equal(ordinary.length, 1); assert.equal(ordinary[0].Non_unique, 1);
    await fields.updateSchema(upgrade, 'code', { indexed: false }); assert.deepEqual(await rows(upgrade), before);
    await items(upgrade).createOne({ code: 1 });
  });
  await t.test('unique creation with a conflicting constant default fails atomically on a populated table', async () => {
    const existing = await make('new_column'); await items(existing).createMany([{}, {}]); const before = await rows(existing), beforeDdl = await ddl(existing), beforeVersion = await version();
    await assert.rejects(fields.createOne(existing, { field: 'code', type: 'string', required: true, defaultValue: 'same', unique: true }), { code: 'DUPLICATE_KEY' });
    assert.deepEqual(await rows(existing), before); assert.equal(await ddl(existing), beforeDdl); assert.equal(await fields.readOne(existing, 'code'), null); assert.equal(await version(), beforeVersion);
  });
  await t.test('metadata transaction failures compensate unique DDL and preserve the original index and records', async () => {
    const failed = await make('compensation'); await fields.createOne(failed, { field: 'code', type: 'string', indexed: true }); await items(failed).createMany([{ code: 'one' }, { code: 'two' }]);
    const before = await rows(failed), beforeDdl = await ddl(failed), beforeField = await fields.readOne(failed, 'code'), beforeVersion = await version();
    const database = intercept(async (sql, _params, run) => { if (sql.startsWith('UPDATE yuncms_fields SET')) throw Object.assign(Error('Injected metadata failure'), { code: 'TEST_METADATA_FAILURE' }); return run(); });
    await assert.rejects(new FieldsService({ ...basic, database }).updateSchema(failed, 'code', { unique: true, required: true }), { code: 'TEST_METADATA_FAILURE' });
    assert.deepEqual(await rows(failed), before); assert.equal(await ddl(failed), beforeDdl); assert.deepEqual(await fields.readOne(failed, 'code'), beforeField); assert.equal(await version(), beforeVersion);
  });
  await t.test('field uniqueness does not remove a relation-owned unique constraint or its foreign key', async () => {
    const target = await make('target'), source = await make('source'); await fields.createOne(source, { field: 'target_id', type: 'uuid', unique: true });
    await createO2ORelation({ ...basic, input: { manyCollection: source, manyField: 'target_id', oneCollection: target } });
    await fields.updateSchema(source, 'target_id', { unique: false });
    const item = await items(target).createOne({}); await items(source).createOne({ target_id: item.id });
    await assert.rejects(items(source).createOne({ target_id: item.id }), { code: 'ER_DUP_ENTRY' });
    await deleteO2ORelation({ ...basic, manyCollection: source, manyField: 'target_id' }); await items(source).createOne({ target_id: item.id });
  });
  await t.test('disabling uniqueness retains an ordinary index when a many-to-one foreign key depends on it', async () => {
    const target = await make('fk_target'), source = await make('fk_source'); await fields.createOne(source, { field: 'target_id', type: 'uuid', unique: true });
    await new RelationsService(basic).createM2O({ manyCollection: source, manyField: 'target_id', oneCollection: target });
    const beforeDdl = await ddl(source), beforeVersion = await version();
    await assert.rejects(fields.updateSchema(source, 'target_id', { unique: false, indexed: false }), { code: 'INVALID_SCHEMA_PAYLOAD' });
    assert.equal(await ddl(source), beforeDdl); assert.equal(await version(), beforeVersion);
    const updated = await fields.updateSchema(source, 'target_id', { unique: false }); assert.equal(parse(updated.schema_metadata).unique, false); assert.equal(parse(updated.schema_metadata).indexed, true);
    const item = await items(target).createOne({}); await items(source).createMany([{ target_id: item.id }, { target_id: item.id }]);
    await assert.rejects(items(source).createOne({ target_id: 'missing-id' }), { code: 'ER_NO_REFERENCED_ROW_2' });
    await new RelationsService(basic).deleteM2O(source, 'target_id');
  });
  const legacy = await make('legacy'); await fields.createOne(legacy, { field: 'title', type: 'string' }); const old = await items(legacy).createOne({ title: 'preserved' });
  await t.test('existing-collection managed-field migration is additive, idempotent and preserves legacy rows and metadata', async () => {
    const before = Date.now(); const requested = ['created_at', 'updated_at', 'created_by', 'updated_by'];
    const result = await request(`/schema/collections/${legacy}`, adminToken, 'PATCH', { systemFields: requested, metadata: { icon: 'message' } }); assert.equal(result.status, 200);
    const record = (await rows(legacy))[0]; assert.equal(record.id, old.id); assert.equal(record.title, 'preserved'); assert.equal(record.created_by, null); assert.equal(record.updated_by, null); assert.ok(new Date(record.created_at).getTime() >= before - 1000);
    const nativeFields = await fields.readMany(legacy); for (const field of nativeFields.filter(field => requested.includes(field.field))) { assert.equal(field.readonly, 1); assert.equal(parse(field.schema_metadata).systemManaged, true); assert.ok(parse(field.schema_metadata).special); }
    const beforeVersion = await version(), beforeDdl = await ddl(legacy), beforeRows = await rows(legacy);
    await collections.updateOne(legacy, { systemFields: requested }); await collections.updateOne(legacy, { systemFields: [] });
    assert.equal(await version(), beforeVersion); assert.equal(await ddl(legacy), beforeDdl); assert.deepEqual(await rows(legacy), beforeRows); assert.equal(parse((await collections.readOne(legacy)).metadata).icon, 'message');
  });
  await t.test('migrated managed fields stamp verified actors, reject forgeries and preserve user foreign keys', async () => {
    const service = new ItemsService(legacy, { ...basic, accountability: createAccountability({ user: admin.id, admin: true }) });
    const created = await service.createOne({ title: 'after migration' }); assert.equal(created.created_by, admin.id); assert.equal(created.updated_by, admin.id);
    await assert.rejects(service.createOne({ title: 'forged', created_by: staff.id }), { code: 'FIELD_READ_ONLY' });
    await assert.rejects(service.updateOne(created.id, { created_at: '2000-01-01T00:00:00Z' }), { code: 'FIELD_READ_ONLY' });
    const changed = await service.updateOne(old.id, { title: 'changed' }); assert.equal(changed.created_by, null); assert.equal(changed.updated_by, admin.id);
    await assert.rejects(fields.updateSchema(legacy, 'created_by', { unique: true }), { code: 'SYSTEM_SCHEMA_READ_ONLY' });
    const [fks] = await pool.query('SELECT REFERENCED_TABLE_NAME FROM information_schema.key_column_usage WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND REFERENCED_TABLE_NAME IS NOT NULL', [config.database.database, legacy]); assert.equal(fks.length, 2); assert.ok(fks.every(row => row.REFERENCED_TABLE_NAME === 'yuncms_users'));
  });
  await t.test('managed-field collisions, non-admin migrations and native-system mutation leave schema/data unchanged', async () => {
    const collision = await make('collision'); await fields.createOne(collision, { field: 'created_by', type: 'uuid', defaultPreset: 'current_user' });
    const beforeDdl = await ddl(collision), beforeVersion = await version();
    const result = await request(`/schema/collections/${collision}`, adminToken, 'PATCH', { systemFields: ['created_at', 'created_by'] }); assert.equal(result.status, 409); assert.equal(result.body.errors[0].code, 'FIELD_EXISTS');
    assert.equal((await request(`/schema/collections/${collision}`, staffToken, 'PATCH', { systemFields: ['updated_at'] })).status, 403);
    assert.equal((await request(`/schema/collections/${c}/fields/slug/schema`, staffToken, 'PATCH', { unique: false })).status, 403);
    await assert.rejects(collections.updateOne('yuncms_users', { systemFields: ['created_at'] }), { code: 'SYSTEM_SCHEMA_READ_ONLY' });
    assert.equal(await ddl(collision), beforeDdl); assert.equal(await version(), beforeVersion);
  });
  await t.test('managed-field metadata failure restores the original physical schema and rolls back every new metadata row', async () => {
    const failed = await make('managed_failure'); await fields.createOne(failed, { field: 'title', type: 'string' }); await items(failed).createOne({ title: 'existing' });
    const before = await rows(failed), beforeDdl = await ddl(failed), beforeFields = await fields.readMany(failed), beforeVersion = await version();
    const database = intercept(async (sql, params, run) => { if (sql.startsWith('INSERT INTO yuncms_fields') && params[1] === 'created_by') throw Object.assign(Error('Injected metadata failure'), { code: 'TEST_METADATA_FAILURE' }); return run(); });
    await assert.rejects(new CollectionsService({ ...basic, database }).updateOne(failed, { systemFields: ['created_at', 'updated_at', 'created_by', 'updated_by'] }), { code: 'TEST_METADATA_FAILURE' });
    assert.deepEqual(await rows(failed), before); assert.equal(await ddl(failed), beforeDdl); assert.deepEqual(await fields.readMany(failed), beforeFields); assert.equal(await version(), beforeVersion);
  });
});
