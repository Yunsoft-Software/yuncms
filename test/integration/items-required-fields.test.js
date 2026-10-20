import assert from 'node:assert/strict';
import test from 'node:test';
import { randomBytes } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  bootstrapDatabase, CollectionsService, createCoreServiceRegistry, createDatabasePool, createSystemAccountability,
  createStorageRegistry, FieldsService, HookEmitter, ItemsService, loadConfig, LocalStorageDriver,
  RolesService, SchemaCache, UsersService,
} from '@yunsoft/yuncms-core';
import { createApp } from '../../packages/api/src/app.js';
import { registerInternalAudit } from '../../packages/api/src/audit-hooks.js';

test('required values reject explicit null before SQL and preserve native single/bulk writes', {
  skip: process.env.YUNCMS_TEST_MYSQL !== '1', timeout: 90_000,
}, async t => {
  assert.equal(process.env.YUNCMS_TEST_DB_ALLOW_DESTRUCTIVE, '1');
  const config = loadConfig(process.env);
  assert.match(config.database.database, /(?:test|ci|dev)/i);
  const pool = createDatabasePool(config.database), suffix = randomBytes(5).toString('hex');
  const collection = `it_required_${suffix}`, root = await mkdtemp(join(tmpdir(), 'yuncms-required-'));
  const emitter = new HookEmitter(), committed = [];
  for (const event of ['items.create', 'items.update']) emitter.registerAction(event, payload => { committed.push({ event, payload }); });
  registerInternalAudit({ emitter, services: createCoreServiceRegistry().toObject(), database: pool, logger: { error() {} } });
  const options = { database: pool, emitter, accountability: createSystemAccountability(), schemaCache: new SchemaCache({ versionCheckTtlMs: 0 }) };
  const storage = createStorageRegistry({ local: new LocalStorageDriver({ root }) });
  let server, role, user;
  t.after(async () => {
    try {
      if (server) await new Promise(resolve => server.close(resolve));
      await new CollectionsService(options).deleteOne(collection, { destructive: true });
      // Fixture teardown only: the native user service correctly protects the
      // final administrator, which is the sole actor in this disposable DB.
      if (user) await pool.query('DELETE FROM yuncms_users WHERE id = ?', [user.id]);
      if (role) await pool.query('DELETE FROM yuncms_roles WHERE id = ?', [role.id]);
    } finally { await pool.end(); await rm(root, { recursive: true, force: true }); }
  });
  await bootstrapDatabase(pool);
  await new CollectionsService(options).createOne({ collection, systemFields: ['created_at', 'updated_at'] });
  const fields = new FieldsService(options);
  for (const [field, type] of [['title', 'string'], ['quantity', 'integer'], ['active', 'boolean']]) {
    await fields.createOne(collection, { field, type, required: true });
  }
  await fields.createOne(collection, { field: 'optional', type: 'string' });
  await fields.createOne(collection, { field: 'defaulted', type: 'integer', required: true, defaultValue: 7 });
  role = await new RolesService(options).createOne({ name: `Required admin ${suffix}`, admin: true });
  const password = `Required-${suffix}-Pass!`;
  user = await new UsersService(options).createOne({ email: `required-${suffix}@example.test`, password, role: role.id });
  const start = async () => {
    const app = createApp({ pool, config, schemaCache: new SchemaCache({ versionCheckTtlMs: 0 }), emitter, storage,
      logger: { info() {}, warn() {}, error() {} } });
    server = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  };
  await start();
  const request = async (path, method = 'GET', body, token) => {
    const response = await fetch(`http://127.0.0.1:${server.address().port}${path}`, { method,
      headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    return { status: response.status, body: await response.json() };
  };
  const login = async () => {
    const response = await request('/auth/login', 'POST', { email: user.email, password });
    assert.equal(response.status, 200); return response.body.data.access_token;
  };
  let token = await login();
  const path = `/items/${collection}`, valid = { title: 'Zero and false', quantity: 0, active: false, optional: null };
  const created = await request(path, 'POST', valid, token); assert.equal(created.status, 201);
  const id = created.body.data.id;
  const readback = async () => (await pool.query(`SELECT * FROM \`${collection}\` ORDER BY id`))[0];
  const auditReadback = async () => (await pool.query('SELECT * FROM yuncms_audit_log WHERE collection = ? ORDER BY id', [collection]))[0];
  let baseline = await readback();
  let auditBaseline = await auditReadback(), committedBaseline = structuredClone(committed);
  assert.ok(auditBaseline.some(entry => entry.action === 'items.create'));
  assert.ok(committedBaseline.length > 0);
  const assertUnchanged = async () => {
    assert.deepEqual(await readback(), baseline);
    assert.deepEqual(await auditReadback(), auditBaseline);
    assert.deepEqual(committed, committedBaseline);
  };
  assert.equal(baseline[0].quantity, 0); assert.equal(baseline[0].active, 0);
  assert.equal(baseline[0].defaulted, 7); assert.ok(baseline[0].created_at);
  for (const method of ['POST', 'PATCH']) for (const field of ['title', 'quantity', 'active', 'defaulted']) {
    await t.test(`${method} required ${field}=null returns safe 400 and leaves SQL unchanged`, async () => {
      const response = await request(method === 'POST' ? path : `${path}/${id}`, method,
        { ...(method === 'POST' ? valid : {}), [field]: null }, token);
      await assertUnchanged();
      assert.equal(response.status, 400, JSON.stringify({ method, field, response }));
      assert.equal(response.body.errors[0].code, 'REQUIRED_FIELD_MISSING');
      assert.equal(response.body.errors[0].path, field);
      assert.doesNotMatch(JSON.stringify(response.body), /ER_BAD_NULL|INSERT INTO|UPDATE `|mysql/i);
    });
  }
  await t.test('native bulk creation rolls back every row and bulk null update preserves SQL', async () => {
    const service = new ItemsService(collection, options);
    await assert.rejects(service.createMany([valid, { ...valid, active: null }]), { code: 'REQUIRED_FIELD_MISSING' });
    await assert.rejects(service.updateMany({ id: { _eq: id } }, { quantity: null }), { code: 'REQUIRED_FIELD_MISSING' });
    await assertUnchanged();
  });
  await t.test('concurrent invalid writes all reject without partial persistence', async () => {
    const results = await Promise.all(['title', 'quantity', 'active'].map(field => request(`${path}/${id}`, 'PATCH', { [field]: null }, token)));
    await assertUnchanged();
    assert.deepEqual(results.map(result => result.status), [400, 400, 400]);
  });
  await t.test('partial PATCH retains zero/false and omitted required fields across API restart', async () => {
    const response = await request(`${path}/${id}`, 'PATCH', { optional: 'Updated optional field' }, token);
    assert.equal(response.status, 200); baseline = await readback();
    auditBaseline = await auditReadback(); committedBaseline = structuredClone(committed);
    assert.equal(baseline[0].title, valid.title); assert.equal(baseline[0].active, 0); assert.equal(baseline[0].quantity, 0);
    await new Promise(resolve => server.close(resolve)); server = null;
    await start(); token = await login();
    const restored = await request(`${path}/${id}`, 'GET', undefined, token);
    assert.equal(restored.status, 200); assert.equal(restored.body.data.optional, 'Updated optional field');
    await assertUnchanged();
    const invalid = await request(`${path}/${id}`, 'PATCH', { active: null }, token);
    await assertUnchanged();
    assert.equal(invalid.status, 400);
  });
});
