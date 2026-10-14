import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import express from 'express';
import {
  bootstrapDatabase, createAccountability, createCoreServiceRegistry, createDatabasePool,
  createPublicAccountability, createSystemAccountability, createStorageRegistry, HookEmitter,
  CollectionsService, FieldsService, FilesService, ItemsService, PermissionsService, RolesService,
  UsersService, AuditService, LocalStorageDriver, SchemaCache, loadConfig,
  withAdvisoryLock, withConnectionTransaction, withTransaction,
} from '@yunsoft/yuncms-core';
import { registerInternalAudit } from '../../packages/api/src/audit-hooks.js';
import { createApp } from '../../packages/api/src/app.js';
import { serviceOptionsFromRequest } from '../../packages/api/src/service-options.js';

const ENABLED = process.env.YUNCMS_TEST_MYSQL === '1';
test('native authorization lifecycle writes production audit only after commit without starving a bounded pool', {
  skip: !ENABLED, timeout: 90_000,
}, async t => {
  const config = loadConfig(process.env);
  assert.equal(process.env.YUNCMS_TEST_DB_ALLOW_DESTRUCTIVE, '1'); assert.match(config.database.database, /(test|ci|dev)/i);
  const pool = createDatabasePool({ ...config.database, connectionLimit: 3 });
  const root = await mkdtemp(join(tmpdir(), 'yuncms-auth-audit-'));
  const storage = createStorageRegistry({ local: new LocalStorageDriver({ root }) });
  const system = createSystemAccountability(), basic = { database: pool, accountability: system, storage };
  const run = randomBytes(5).toString('hex'), collection = `it_auth_audit_${run}`;
  const roleIds = [], userIds = [], fileIds = [], auditKeys = new Set(); let server;
  t.after(async () => {
    if (server) await new Promise(resolve => server.close(resolve));
    await pool.query(`DROP TABLE IF EXISTS \`${collection}\``);
    await pool.query('DELETE FROM yuncms_collections WHERE collection = ?', [collection]);
    for (const id of fileIds) await pool.query('DELETE FROM yuncms_files WHERE id = ?', [id]);
    for (const id of userIds) await pool.query('DELETE FROM yuncms_users WHERE id = ?', [id]);
    for (const id of roleIds) { await pool.query('DELETE FROM yuncms_permissions WHERE role = ?', [id]); await pool.query('DELETE FROM yuncms_roles WHERE id = ?', [id]); }
    for (const key of auditKeys) await pool.query('DELETE FROM yuncms_audit_log WHERE item_key = ?', [key]);
    await pool.end(); await rm(root, { recursive: true, force: true });
  });
  await bootstrapDatabase(pool);
  const adminRole = await new RolesService(basic).createOne({ name: `Audit admin ${run}`, admin: true }); roleIds.push(adminRole.id);
  const staffRole = await new RolesService(basic).createOne({ name: `Audit staff ${run}` }); roleIds.push(staffRole.id);
  const password = `Audit-${run}-Pass!`;
  const admin = await new UsersService(basic).createOne({ email: `audit-admin-${run}@example.test`, password, role: adminRole.id }); userIds.push(admin.id);
  const staff = await new UsersService(basic).createOne({ email: `audit-staff-${run}@example.test`, password, role: staffRole.id }); userIds.push(staff.id);
  await new CollectionsService(basic).createOne({ collection });
  await new FieldsService(basic).createOne(collection, { field: 'file_ids', type: 'json' });
  const cache = new SchemaCache({ versionCheckTtlMs: 0 }), schema = await cache.get(pool), auditErrors = [], seen = [];
  const logger = { info() {}, warn() {}, error(message, details) { auditErrors.push({ message, code: details?.code }); } };
  const emitter = new HookEmitter({ logger });
  registerInternalAudit({ emitter, services: createCoreServiceRegistry().toObject(), database: pool, logger });
  const actor = createAccountability({ user: admin.id, role: adminRole.id, admin: true });
  const options = { ...basic, schema, accountability: actor, emitter, requestId: `audit-${run}` };
  for (const resource of ['permissions', 'roles']) for (const operation of ['create', 'update', 'delete']) {
    emitter.registerAction(`${resource}.${operation}`, (payload, ctx) => seen.push({ event: `${resource}.${operation}`, key: payload.key, database: ctx.database, transaction: ctx.transaction, actor: ctx.accountability.user }));
  }
  const auditFor = async (key, event) => (await new AuditService(basic).readMany({ collection: event.startsWith('roles.') ? 'yuncms_roles' : 'yuncms_permissions' })).filter(row => row.item_key === key && row.action === event);
  const invalidItem = database => new ItemsService(collection, { ...options, database }).createOne({ nonexistent_business_field: true });

  for (const resource of ['permissions', 'roles']) for (const operation of ['create', 'update', 'delete']) {
    await t.test(`${resource}.${operation} rollback leaves no success audit and restores the original native record`, async () => {
      const Service = resource === 'roles' ? RolesService : PermissionsService;
      let existing, created;
      if (operation !== 'create') {
        existing = resource === 'roles'
          ? await new Service(basic).createOne({ name: `Rollback role ${operation} ${run}` })
          : await new Service({ ...basic, schema }).createOne({ role: staffRole.id, collection, action: operation === 'update' ? 'read' : 'create' });
        auditKeys.add(existing.id); if (resource === 'roles') roleIds.push(existing.id);
      }
      const seenBefore = seen.length;
      await assert.rejects(withTransaction(pool, async database => {
        const service = new Service({ ...options, database });
        if (operation === 'create') {
          created = resource === 'roles'
            ? await service.createOne({ name: `Rolled back role ${run}` })
            : await service.createOne({ role: staffRole.id, collection, action: 'update' });
          auditKeys.add(created.id);
        } else if (operation === 'update') {
          await service.updateOne(existing.id, resource === 'roles' ? { description: 'must roll back' } : { fields: ['file_ids'] });
        } else await service.deleteOne(existing.id);
        await invalidItem(database);
      }));
      const key = (created ?? existing).id;
      const after = await new Service({ ...basic, schema }).readOne(key);
      if (operation === 'create') assert.equal(after, null); else assert.deepEqual(after, existing);
      assert.equal((await auditFor(key, `${resource}.${operation}`)).length, 0);
      assert.equal(seen.length, seenBefore);
      if (resource === 'permissions' && existing) await new Service({ ...basic, schema }).deleteOne(existing.id);
    });
  }

  await t.test('committed permission/role mutations audit once, preserve order and snapshot payloads with verified attribution', async () => {
    const seenBefore = seen.length; let role, permission;
    await withTransaction(pool, async database => {
      const roles = new RolesService({ ...options, database }), permissions = new PermissionsService({ ...options, database });
      role = await roles.createOne({ name: `Committed lifecycle ${run}` }); auditKeys.add(role.id);
      const patch = { description: 'committed description' }; await roles.updateOne(role.id, patch); patch.description = 'caller-forged after queue';
      permission = await permissions.createOne({ role: role.id, collection, action: 'read' }); auditKeys.add(permission.id);
      const permissionPatch = { fields: ['file_ids'] }; await permissions.updateOne(permission.id, permissionPatch); permissionPatch.fields[0] = 'caller-forged';
      await permissions.deleteOne(permission.id); await roles.deleteOne(role.id);
      assert.equal(seen.length, seenBefore);
    });
    const events = seen.slice(seenBefore); assert.deepEqual(events.map(event => event.event), ['roles.create', 'roles.update', 'permissions.create', 'permissions.update', 'permissions.delete', 'roles.delete']);
    for (const event of events) { assert.equal(event.database, pool); assert.deepEqual(event.transaction, { managed: true, state: 'committed' }); assert.equal(event.actor, admin.id); const audits = await auditFor(event.key, event.event); assert.equal(audits.length, 1); assert.equal(audits[0].user, admin.id); assert.equal(audits[0].request_id, options.requestId); }
    assert.equal((await auditFor(role.id, 'roles.update'))[0].payload.changes.description, 'committed description');
    assert.deepEqual((await auditFor(permission.id, 'permissions.update'))[0].payload.changes.fields, ['file_ids']);
  });

  await t.test('denied caller authority cannot create an authorization record or queue success actions', async () => {
    const seenBefore = seen.length;
    for (const accountability of [createPublicAccountability(), createAccountability({ user: staff.id, role: staffRole.id })]) {
      await assert.rejects(withTransaction(pool, async database => new PermissionsService({ ...options, database, accountability }).createOne({ role: staffRole.id, collection, action: 'read' })), { code: 'FORBIDDEN' });
      await assert.rejects(withTransaction(pool, async database => new RolesService({ ...options, database, accountability }).createOne({ name: 'Forbidden role' })), { code: 'FORBIDDEN' });
    }
    assert.equal(seen.length, seenBefore);
  });

  await t.test('caller-owned one-connection transactions carry the usable connection into production audit', async () => {
    const tiny = createDatabasePool({ ...config.database, connectionLimit: 1 });
    const tinyEmitter = new HookEmitter({ logger }), tinySeen = [];
    registerInternalAudit({ emitter: tinyEmitter, services: createCoreServiceRegistry().toObject(), database: tiny, logger });
    tinyEmitter.registerAction('permissions.create', (payload, ctx) => tinySeen.push({ key: payload.key, database: ctx.database, transaction: ctx.transaction }));
    try {
      await withAdvisoryLock(tiny, `audit-single-${run}`, async database => withConnectionTransaction(database, async () => {
        const permission = await new PermissionsService({ ...options, database, emitter: tinyEmitter }).createOne({ role: staffRole.id, collection, action: 'delete' }); auditKeys.add(permission.id);
      }));
      assert.equal(tinySeen.length, 1); const event = tinySeen[0]; assert.notEqual(event.database, tiny); assert.equal(typeof event.database.query, 'function'); assert.deepEqual(event.transaction, { managed: true, state: 'committed' });
      assert.equal((await auditFor(event.key, 'permissions.create')).length, 1);
    } finally { await tiny.end(); }
  });

  await t.test('three concurrent authenticated file-sharing transactions retain every file and avoid audit pool starvation', async () => {
    const setting = await new ItemsService(collection, { ...basic, schema }).createOne({ file_ids: [] }); auditKeys.add(setting.id);
    const grant = await new PermissionsService({ ...basic, schema }).createOne({ role: staffRole.id, collection: 'yuncms_files', action: 'read', filter: { id: { _in: [] } } }); auditKeys.add(grant.id);
    for (let i = 0; i < 3; i++) fileIds.push((await new FilesService({ ...basic, schema, accountability: actor }).createOne({ contents: Buffer.from(`share-${i}`), filenameDownload: `share-${i}.txt` })).id);
    let entrants = 0, ready; const allQueued = new Promise(resolve => { ready = resolve; });
    const lockedPool = { async getConnection() {
      const connection = await pool.getConnection();
      return new Proxy(connection, { get(target, key) {
        if (key === 'query') return (sql, params) => { if (sql.includes('GET_LOCK')) { entrants++; if (entrants === 3) ready(); } return target.query(sql, params); };
        const value = Reflect.get(target, key); return typeof value === 'function' ? value.bind(target) : value;
      } });
    } };
    const router = express.Router();
    router.post('/', async (req, res) => {
      if (!req.accountability.admin) throw Object.assign(Error('Administrator required'), { code: 'FORBIDDEN' });
      const result = await withAdvisoryLock(lockedPool, `file-sharing-${run}`, async database => {
        await allQueued;
        return withConnectionTransaction(database, async () => {
          const native = { ...serviceOptionsFromRequest(req), database };
          assert.equal(native.accountability.user, admin.id);
          assert.ok(await new FilesService(native).readOne(req.body.fileId));
          const items = new ItemsService(collection, native), before = await items.readOne(setting.id);
          const next = [...new Set([...before.file_ids, req.body.fileId])];
          await items.updateOne(setting.id, { file_ids: next });
          await new PermissionsService(native).updateOne(grant.id, { filter: { id: { _in: next } } });
          return next;
        });
      }, { timeoutSeconds: 2 });
      res.json({ data: result });
    });
    const app = createApp({ pool, config, schemaCache: cache, storage, emitter, logger, endpointExtensions: [{ id: 'sharing', router }] });
    server = await new Promise(resolve => { const instance = app.listen(0, '127.0.0.1', () => resolve(instance)); });
    const base = `http://127.0.0.1:${server.address().port}`;
    const login = async user => { const response = await fetch(base+'/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: user.email, password }) }); assert.equal(response.status, 200); return (await response.json()).data.access_token; };
    const adminToken = await login(admin), staffToken = await login(staff);
    const call = token => fileId => fetch(base+'/extensions/sharing', { method: 'POST', headers: { authorization: 'Bearer '+token, 'content-type': 'application/json' }, body: JSON.stringify({ fileId }) });
    assert.equal((await call(staffToken)(fileIds[0])).status, 403); assert.equal(entrants, 0);
    const results = await Promise.all(fileIds.map(call(adminToken))); assert.deepEqual(results.map(response => response.status), [200,200,200]);
    assert.equal(entrants, 3);
    const stored = await new ItemsService(collection, { ...basic, schema }).readOne(setting.id); assert.deepEqual(stored.file_ids.toSorted(), fileIds.toSorted());
    const permission = await new PermissionsService({ ...basic, schema }).readOne(grant.id); assert.deepEqual(permission.filter.id._in.toSorted(), fileIds.toSorted());
    assert.equal((await auditFor(grant.id, 'permissions.update')).length, 3);
  });
  assert.deepEqual(auditErrors, []);
});
