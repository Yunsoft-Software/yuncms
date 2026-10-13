import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import express from 'express';
import { ExtensionError } from '@yunsoft/yuncms-extensions-sdk';
import {
  bootstrapDatabase, createAccountability, createDatabasePool, createStorageRegistry,
  createSystemAccountability, CollectionsService, FieldsService, FilesService,
  HookEmitter, ItemsService, loadConfig, LocalStorageDriver, PermissionsService, ExternalAuthService, createPublicAccountability,
  RelationsService, RolesService, SchemaCache, UsersService, withTransaction,
} from '@yunsoft/yuncms-core';
import { createApp } from '../../packages/api/src/app.js';

test('native file permissions, user/schema filters and identity relations enforce real HTTP/MySQL boundaries', {
  skip: process.env.YUNCMS_TEST_MYSQL !== '1', timeout: 90_000,
}, async t => {
  const config = loadConfig(process.env);
  assert.equal(process.env.YUNCMS_TEST_DB_ALLOW_DESTRUCTIVE, '1');
  assert.match(config.database.database, /(test|ci|dev)/i);
  const pool = createDatabasePool(config.database), system = createSystemAccountability();
  const run = randomBytes(5).toString('hex'), collection = `it_native_${run}`, junction = `it_native_links_${run}`;
  const root = await mkdtemp(join(tmpdir(), 'yuncms-native-'));
  const driver = new LocalStorageDriver({ root }), storage = createStorageRegistry({ local: driver });
  const cache = new SchemaCache({ versionCheckTtlMs: 0 }), emitter = new HookEmitter();
  const roles = [], users = [], files = [], actions = [];
  let server, rejectCreate = false, rejectActivation = false, rejectSchema = false;
  const basic = { database: pool, accountability: system, storage };
  const fresh = async (accountability = system, extra = {}) => ({ ...basic, accountability, schema: await cache.get(pool), ...extra });
  emitter.registerFilter('users.create', (payload, context) => {
    assert.ok(context.accountability.admin || context.accountability.public);
    if (rejectCreate || payload.email?.startsWith('blocked-')) throw new ExtensionError('QUOTA_REACHED', 'User quota reached', { status: 403 });
    return payload;
  });
  emitter.registerFilter('users.update', (payload, context) => {
    if (rejectActivation && payload.status === 'active') {
      assert.equal(context.before.status, 'disabled');
      throw new ExtensionError('QUOTA_REACHED', 'User quota reached', { status: 403 });
    }
    return payload;
  });
  emitter.registerFilter('schema.collection.create', payload => {
    if (rejectSchema) throw new ExtensionError('APP_READ_ONLY', 'Application is read-only', { status: 403 });
    return payload;
  });
  emitter.registerAction('users.create', payload => { actions.push(payload.key); });
  t.after(async () => {
    if (server) await new Promise(resolve => server.close(resolve));
    await pool.query(`DROP TABLE IF EXISTS \`${junction}\``);
    await pool.query(`DROP TABLE IF EXISTS \`${collection}\``);
    await pool.query('DELETE FROM yuncms_collections WHERE collection IN (?, ?)', [junction, collection]);
    for (const file of files) await pool.query('DELETE FROM yuncms_files WHERE id = ?', [file.id]);
    for (const user of users) await pool.query('DELETE FROM yuncms_users WHERE id = ?', [user.id]);
    for (const role of roles) { await pool.query('DELETE FROM yuncms_permissions WHERE role = ?', [role.id]); await pool.query('DELETE FROM yuncms_roles WHERE id = ?', [role.id]); }
    await pool.end(); await rm(root, { recursive: true, force: true });
  });
  await bootstrapDatabase(pool);
  const roleService = new RolesService(basic), userService = new UsersService(basic);
  const adminRole = await roleService.createOne({ name: `Native admin ${run}`, admin: true }); roles.push(adminRole);
  const staffRole = await roleService.createOne({ name: `Native staff ${run}` }); roles.push(staffRole);
  const password = `Fixture-${run}-Pass!`;
  const admin = await userService.createOne({ email: `native-admin-${run}@example.test`, password, role: adminRole.id }); users.push(admin);
  const a = await userService.createOne({ email: `native-a-${run}@example.test`, password, role: staffRole.id }); users.push(a);
  const b = await userService.createOne({ email: `native-b-${run}@example.test`, password, role: staffRole.id }); users.push(b);
  const inactive = await userService.createOne({ email: `native-off-${run}@example.test`, password, role: staffRole.id, status: 'disabled' }); users.push(inactive);
  const accountB = createAccountability({ user: b.id, role: staffRole.id });
  const fileFor = async user => new FilesService(await fresh(createAccountability({ user: user.id, role: adminRole.id, admin: true }))).createOne({ contents: Buffer.from('private-content'), filenameDownload: 'fixture.txt', title: 'original' });
  const fileA = await fileFor(a), fileB = await fileFor(b); files.push(fileA, fileB);
  let permissionService = new PermissionsService(await fresh());
  for (const action of ['read', 'update', 'delete']) await permissionService.createOne({ role: staffRole.id, collection: 'yuncms_files', action, filter: { uploaded_by: { _eq: '$CURRENT_USER' } }, ...(action === 'update' ? { fields: ['title'], validation: { title: { _starts_with: 'Allowed' } } } : {}) });
  const diagnostic = express.Router();
  diagnostic.get('/', () => { throw Object.assign(new Error('Private diagnostic'), { path: root, code: 'INTERNAL_DIAGNOSTIC' }); });
  const app = createApp({ pool, config, schemaCache: cache, storage, emitter, logger: { info() {}, warn() {}, error() {} }, endpointExtensions: [{ id: 'diagnostic', router: diagnostic }] });
  server = await new Promise(resolve => { const instance = app.listen(0, '127.0.0.1', () => resolve(instance)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const request = async (path, token, method = 'GET', body) => {
    const response = await fetch(`${base}${path}`, { method, headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...(body !== undefined ? { 'content-type': 'application/json' } : {}) }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
    return { status: response.status, body: response.status === 204 ? null : await response.json() };
  };
  const login = async user => { const r = await request('/auth/login', null, 'POST', { email: user.email, password }); assert.equal(r.status, 200); return r.body.data.access_token; };
  const adminToken = await login(admin), bToken = await login(b);
  await t.test('public HTTP boundaries reject native management and sanitize internal diagnostics', async () => {
    for (const path of ['/users', '/permissions', '/schema/collections']) assert.equal((await request(path, null, 'POST', {})).status, 403);
    const internal = await request('/extensions/diagnostic');
    assert.equal(internal.status, 500); assert.equal(Object.hasOwn(internal.body.errors[0], 'path'), false); assert.equal(internal.body.errors[0].message, 'Internal server error');
  });
  await t.test('file owner scope denies foreign updates/deletes and preserves both storage and metadata', async () => {
    assert.equal((await request(`/files/${fileA.id}`, bToken, 'PATCH', { title: 'Allowed foreign' })).status, 404);
    assert.equal((await request(`/files/${fileA.id}`, bToken, 'DELETE')).status, 404);
    assert.equal((await new FilesService(await fresh()).readOne(fileA.id)).title, 'original');
    assert.equal((await driver.get(fileA.filename_disk)).toString(), 'private-content');
    assert.equal((await request(`/files/${fileB.id}`, bToken, 'PATCH', { filenameDownload: 'blocked.txt' })).status, 403);
    assert.equal((await request(`/files/${fileB.id}`, bToken, 'PATCH', { title: 'Denied validation' })).status, 400);
    assert.equal((await request(`/files/${fileB.id}`, bToken, 'PATCH', { title: 'Allowed own' })).status, 200);
    const readGrant = (await permissionService.readMany()).find(p => p.role === staffRole.id && p.collection === 'yuncms_files' && p.action === 'read');
    await permissionService.updateOne(readGrant.id, { filter: { title: { _eq: 'hidden-to-reader' } } });
    const hidden = await request(`/files/${fileB.id}`, bToken, 'PATCH', { title: 'Allowed hidden' }); assert.equal(hidden.status, 200); assert.deepEqual(hidden.body.data, { id: fileB.id });
    await permissionService.deleteOne(readGrant.id);
    const writeOnly = await request(`/files/${fileB.id}`, bToken, 'PATCH', { title: 'Allowed own' }); assert.equal(writeOnly.status, 200); assert.deepEqual(writeOnly.body.data, { id: fileB.id });
    await permissionService.createOne({ role: staffRole.id, collection: 'yuncms_files', action: 'read', filter: { uploaded_by: { _eq: '$CURRENT_USER' } } });
    assert.equal((await request(`/files/${fileA.id}/content`, bToken)).status, 404);
  });
  await t.test('typed user and schema filters deny HTTP writes without persistence', async () => {
    const [[before]] = await pool.query('SELECT COUNT(*) AS total FROM yuncms_users');
    rejectCreate = true;
    const denied = await request('/users', adminToken, 'POST', { email: `reject-${run}@example.test`, password, role: staffRole.id });
    assert.equal(denied.status, 403); assert.equal(denied.body.errors[0].code, 'QUOTA_REACHED');
    const [[after]] = await pool.query('SELECT COUNT(*) AS total FROM yuncms_users'); assert.equal(after.total, before.total);
    rejectCreate = false; rejectActivation = true;
    assert.equal((await request(`/users/${inactive.id}`, adminToken, 'PATCH', { status: 'active' })).status, 403);
    assert.equal((await userService.readOne(inactive.id)).status, 'disabled'); rejectActivation = false;
    rejectSchema = true;
    const [[versionBefore]] = await pool.query('SELECT version FROM yuncms_schema_state WHERE id = 1');
    assert.equal((await request('/schema/collections', adminToken, 'POST', { collection })).status, 403);
    const [[count]] = await pool.query('SELECT COUNT(*) AS total FROM information_schema.tables WHERE table_schema = ? AND table_name = ?', [config.database.database, collection]); assert.equal(Number(count.total), 0);
    const [[versionAfter]] = await pool.query('SELECT version FROM yuncms_schema_state WHERE id = 1'); assert.equal(versionAfter.version, versionBefore.version); rejectSchema = false;
  });
  await t.test('outer user transaction rolls back earlier writes and suppresses success actions', async () => {
    const email = `atomic-${run}@example.test`, actionCount = actions.length;
    await assert.rejects(withTransaction(pool, async database => {
      const service = new UsersService({ ...(await fresh()), database, emitter });
      await service.createOne({ email, password, role: staffRole.id });
      await service.createOne({ email: `blocked-${run}@example.test`, password, role: staffRole.id });
    }), { code: 'QUOTA_REACHED' });
    const [[count]] = await pool.query('SELECT COUNT(*) AS total FROM yuncms_users WHERE email = ?', [email]); assert.equal(Number(count.total), 0); assert.equal(actions.length, actionCount);
    const created = await new UsersService({ ...(await fresh()), emitter }).createOne({ email, password, role: staffRole.id }); users.push(created);
    assert.equal(actions.length, actionCount + 1); assert.equal(actions.at(-1), created.id);
  });
  await t.test('external authentication JIT cannot bypass the native user-create gate', async () => {
    rejectCreate = true;
    const email = `external-${run}@example.test`;
    const external = new ExternalAuthService({ ...(await fresh(createPublicAccountability())), emitter });
    await assert.rejects(external.completeLogin({ provider: `native-${run}`, subject: `subject-${run}`, email, emailVerified: true, policy: { jit: true, defaultRole: staffRole.id } }), { code: 'QUOTA_REACHED' });
    const [[count]] = await pool.query('SELECT COUNT(*) AS total FROM yuncms_users WHERE email = ?', [email]); assert.equal(Number(count.total), 0);
    const [[identities]] = await pool.query('SELECT COUNT(*) AS total FROM yuncms_auth_identities WHERE provider = ?', [`native-${run}`]); assert.equal(Number(identities.total), 0);
    rejectCreate = false;
  });
  await t.test('native M2O/M2M create application FKs and preserve protected system schemas', async () => {
    await new CollectionsService(basic).createOne({ collection });
    const fields = new FieldsService(basic);
    for (const field of ['owner', 'asset', 'compensated']) await fields.createOne(collection, { field, type: 'uuid' });
    const relations = new RelationsService(basic);
    await assert.rejects(relations.createM2O({ manyCollection: collection, manyField: 'owner', oneCollection: 'yuncms_users' }), { code: 'SYSTEM_SCHEMA_READ_ONLY' });
    const [[usersBefore]] = await pool.query('SHOW CREATE TABLE yuncms_users'); const [[filesBefore]] = await pool.query('SHOW CREATE TABLE yuncms_files');
    assert.equal((await request('/schema/relations/native/m2o', bToken, 'POST', { manyCollection: collection, manyField: 'owner', oneCollection: 'yuncms_users' })).status, 403);
    const owner = await request('/schema/relations/native/m2o', adminToken, 'POST', { manyCollection: collection, manyField: 'owner', oneCollection: 'yuncms_users' }); assert.equal(owner.status, 201);
    assert.equal((await request('/schema/relations/native/m2o', adminToken, 'POST', { manyCollection: collection, manyField: 'asset', oneCollection: 'yuncms_files', onDelete: 'SET NULL' })).status, 201);
    assert.equal((await request('/schema/relations/native/m2m', adminToken, 'POST', { junctionCollection: junction, leftCollection: collection, rightCollection: 'yuncms_users' })).status, 201);
    const [[usersAfter]] = await pool.query('SHOW CREATE TABLE yuncms_users'); const [[filesAfter]] = await pool.query('SHOW CREATE TABLE yuncms_files');
    assert.deepEqual(usersAfter, usersBefore); assert.deepEqual(filesAfter, filesBefore);
    const [fks] = await pool.query('SELECT referenced_table_name FROM information_schema.key_column_usage WHERE table_schema = ? AND table_name IN (?, ?) AND referenced_table_name IS NOT NULL', [config.database.database, collection, junction]); assert.equal(fks.length, 4);
  });
  await t.test('native relation DDL compensation removes a FK after metadata insert failure', async () => {
    const wrapped = { async getConnection() {
      const connection = await pool.getConnection();
      return new Proxy(connection, { get(target, key) {
        if (key === 'query') return async (sql, params) => { if (/INSERT INTO yuncms_relations/.test(sql)) throw new Error('Injected metadata failure'); return target.query(sql, params); };
        return typeof target[key] === 'function' ? target[key].bind(target) : target[key];
      } });
    } };
    await assert.rejects(new RelationsService({ ...basic, database: wrapped }).createNativeM2O({ manyCollection: collection, manyField: 'compensated', oneCollection: 'yuncms_users' }), /Injected metadata failure/);
    const [fks] = await pool.query('SELECT constraint_name FROM information_schema.key_column_usage WHERE table_schema = ? AND table_name = ? AND column_name = ? AND referenced_table_name IS NOT NULL', [config.database.database, collection, 'compensated']); assert.equal(fks.length, 0);
    const [metadata] = await pool.query('SELECT id FROM yuncms_relations WHERE many_collection = ? AND many_field = ?', [collection, 'compensated']); assert.equal(metadata.length, 0);
  });
  await t.test('native reference writes/expansions enforce target and junction permissions', async () => {
    permissionService = new PermissionsService(await fresh());
    for (const c of [collection, junction]) for (const action of ['create', 'read', 'update', 'delete']) await permissionService.createOne({ role: staffRole.id, collection: c, action });
    assert.equal((await request(`/users/${b.id}`, bToken)).status, 200);
    assert.equal((await request('/users', bToken)).status, 403);
    const ownReference = await request(`/items/${collection}`, bToken, 'POST', { owner: b.id });
    assert.equal(ownReference.status, 201);
    assert.equal((await request(`/items/${collection}/${ownReference.body.data.id}?fields=owner.email`, bToken)).status, 403);
    assert.equal((await request(`/items/${junction}`, bToken, 'POST', { [`${collection}_id`]: ownReference.body.data.id, user_id: b.id })).status, 201);
    const [[beforeSelfBulk]] = await pool.query(`SELECT COUNT(*) AS total FROM \`${collection}\``);
    await assert.rejects(new ItemsService(collection, await fresh(accountB)).createMany([{ owner: b.id }, { owner: a.id }]), { code: 'FORBIDDEN' });
    const [[afterSelfBulk]] = await pool.query(`SELECT COUNT(*) AS total FROM \`${collection}\``); assert.equal(afterSelfBulk.total, beforeSelfBulk.total);
    assert.equal((await request(`/items/${collection}`, bToken, 'POST', { owner: a.id })).status, 403);
    await permissionService.createOne({ role: staffRole.id, collection: 'yuncms_users', action: 'read' });
    const created = await request(`/items/${collection}`, bToken, 'POST', { owner: a.id, asset: fileB.id }); assert.equal(created.status, 201); const item = created.body.data;
    assert.equal((await request(`/items/${collection}`, bToken, 'POST', { asset: fileA.id })).status, 403);
    assert.equal((await request(`/items/${collection}/${item.id}`, bToken, 'PATCH', { owner: 'invalid UUID' })).status, 400);
    const expanded = await request(`/items/${collection}/${item.id}?fields=id,owner.email,asset.title`, bToken); assert.equal(expanded.status, 200); assert.equal(expanded.body.data.owner.email, a.email); assert.equal(expanded.body.data.asset.title, 'Allowed own');
    assert.equal((await request(`/items/${collection}?filter=${encodeURIComponent(JSON.stringify({ owner: { _sql: '1=1' } }))}`, bToken)).status, 400);
    assert.equal((await request(`/items/${collection}?fields=${encodeURIComponent('id,(SELECT password_hash FROM yuncms_users)')}`, bToken)).status, 400);
    assert.equal((await request(`/items/yuncms_users`, bToken)).status, 403);
    assert.equal((await request(`/items/${collection}/${item.id}?fields=owner.password_hash`, adminToken)).status, 400);
    assert.equal((await request(`/items/${collection}/${item.id}?fields=asset.filename_disk`, adminToken)).status, 400);
    const link = await request(`/items/${junction}`, bToken, 'POST', { [`${collection}_id`]: item.id, user_id: a.id }); assert.equal(link.status, 201);
    const many = await request(`/items/${collection}/${item.id}?fields=id,yuncms_users.email`, bToken); assert.equal(many.status, 200); assert.deepEqual(many.body.data.yuncms_users.map(u => u.email), [a.email]);
    const before = await pool.query(`SELECT COUNT(*) AS total FROM \`${collection}\``);
    await assert.rejects(new ItemsService(collection, await fresh(accountB)).createMany([{ owner: a.id }, { asset: fileA.id }]), { code: 'FORBIDDEN' });
    const after = await pool.query(`SELECT COUNT(*) AS total FROM \`${collection}\``); assert.equal(after[0][0].total, before[0][0].total);
    assert.equal((await request(`/users/${a.id}`, adminToken, 'DELETE')).status, 409);
    assert.equal((await request(`/files/${fileB.id}`, bToken, 'DELETE')).status, 204);
    assert.equal(await driver.stat(fileB.filename_disk), null);
    const [[row]] = await pool.query(`SELECT asset FROM \`${collection}\` WHERE id = ?`, [item.id]); assert.equal(row.asset, null);
    assert.equal((await request(`/files/${fileA.id}`, bToken, 'DELETE')).status, 404);
  });

  await t.test('current_user preset survives physical updates, assigns actors and rejects forged identities', async () => {
    const userGrant = (await permissionService.readMany()).find(p => p.role === staffRole.id && p.collection === 'yuncms_users' && p.action === 'read');
    await permissionService.deleteOne(userGrant.id);
    const path = `/schema/collections/${collection}/fields`;
    assert.equal((await request(path, adminToken, 'POST', { field: 'actor', type: 'uuid', defaultPreset: 'current_user' })).status, 201);
    assert.equal((await request(`${path}/actor/schema`, adminToken, 'PATCH', { removeDefaultPreset: true })).status, 200);
    assert.equal((await request(`${path}/actor/schema`, adminToken, 'PATCH', { defaultPreset: 'current_user' })).status, 200);
    assert.equal((await request('/schema/relations/native/m2o', adminToken, 'POST', { manyCollection: collection, manyField: 'actor', oneCollection: 'yuncms_users' })).status, 201);
    permissionService = new PermissionsService(await fresh());
    const createGrant = (await permissionService.readMany()).find(p => p.role === staffRole.id && p.collection === collection && p.action === 'create');
    await permissionService.updateOne(createGrant.id, { fields: ['owner'], validation: { actor: { _eq: '$CURRENT_USER' } } });
    const created = await request(`/items/${collection}`, bToken, 'POST', {}); assert.equal(created.status, 201); assert.equal(created.body.data.actor, b.id);
    const [[row]] = await pool.query(`SELECT actor FROM \`${collection}\` WHERE id = ?`, [created.body.data.id]); assert.equal(row.actor, b.id);
    assert.equal((await request(`/items/${collection}`, bToken, 'POST', { actor: a.id })).status, 400);
    assert.equal((await request(`/items/${collection}/${created.body.data.id}`, bToken, 'PATCH', { actor: b.id })).status, 400);
    assert.equal((await request(`/items/${collection}`, adminToken, 'POST', { actor: b.id })).status, 400);
    const bulk = await new ItemsService(collection, await fresh(accountB)).createMany([{}, {}]); assert.equal(bulk.length, 2); assert.ok(bulk.every(item => item.actor === b.id));
    assert.equal((await request(`/items/${collection}/${created.body.data.id}?fields=actor.email`, bToken)).status, 403);
    assert.equal((await request('/users', bToken)).status, 403);
    await assert.rejects(new ItemsService(collection, await fresh()).createOne({}), { code: 'FORBIDDEN' });
  });

  await t.test('file admission preserves typed HTTP denials and atomically rolls back quota, metadata and blobs', async () => {
    const quota = `it_quota_${run}`;
    await pool.query(`CREATE TABLE \`${quota}\` (id INT PRIMARY KEY, used_bytes INT NOT NULL, max_bytes INT NOT NULL) ENGINE=InnoDB`);
    await pool.query(`INSERT INTO \`${quota}\` VALUES (1, 0, 7)`);
    let readonly = false, reject = false;
    const remove = emitter.registerFilter('files.create', async (_payload, ctx) => {
      assert.equal(ctx.accountability.user, admin.id); assert.equal(ctx.filesize, 7); assert.equal(ctx.uploadedBy, admin.id);
      assert.deepEqual(ctx.transaction, { managed: true, state: 'active' });
      if (readonly) throw new ExtensionError('APP_READ_ONLY', 'Read-only', { status: 403 });
      const [reserved] = await ctx.database.query(`UPDATE \`${quota}\` SET used_bytes = used_bytes + ? WHERE id = 1 AND used_bytes + ? <= max_bytes`, [ctx.filesize, ctx.filesize]);
      if (!reserved.affectedRows || reject) throw new ExtensionError('QUOTA_REACHED', 'Quota reached', { status: 413 });
    });
    const upload = async () => { const response = await fetch(`${base}/files`, { method: 'POST', headers: { authorization: `Bearer ${adminToken}`, 'content-type': 'application/octet-stream', 'x-filename': 'quota.txt' }, body: Buffer.from('content') }); return { status: response.status, body: await response.json() }; };
    const snapshot = async () => { const [[row]] = await pool.query(`SELECT used_bytes FROM \`${quota}\``); const [[count]] = await pool.query('SELECT COUNT(*) AS total FROM yuncms_files'); return { bytes: row.used_bytes, count: count.total, objects: (await driver.list()).length }; };
    try {
      const before = await snapshot(); readonly = true; const ro = await upload(); assert.equal(ro.status, 403); assert.equal(ro.body.errors[0].code, 'APP_READ_ONLY'); assert.deepEqual(await snapshot(), before);
      readonly = false; reject = true; const denied = await upload(); assert.equal(denied.status, 413); assert.equal(denied.body.errors[0].code, 'QUOTA_REACHED'); assert.deepEqual(await snapshot(), before); reject = false;
      await assert.rejects(withTransaction(pool, async database => { await new FilesService({ ...(await fresh(createAccountability({ user: admin.id, role: adminRole.id, admin: true }))), database, emitter }).createOne({ contents: Buffer.from('content'), filenameDownload: 'rolled-back.txt' }); throw Error('outer failure'); }), /outer failure/);
      assert.deepEqual(await snapshot(), before);
      const results = await Promise.all([upload(), upload()]); assert.deepEqual(results.map(r => r.status).sort(), [201, 413]); files.push(results.find(r => r.status === 201).body.data);
      const after = await snapshot(); assert.equal(after.bytes, 7); assert.equal(Number(after.count), Number(before.count) + 1); assert.equal(after.objects, before.objects + 1);
    } finally { remove(); await pool.query(`DROP TABLE \`${quota}\``); }
  });
});
