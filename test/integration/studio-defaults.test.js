import assert from 'node:assert/strict';
import test from 'node:test';
import { bootstrapDatabase, createCoreServiceRegistry, createDatabasePool, createSystemAccountability, loadConfig, RolesService, SchemaCache, UsersService } from '@yunsoft/yuncms-core';
import { createApp } from '../../packages/api/src/app.js';
import { inputValueForField, outputValueForField } from '../../apps/studio/src/content-field-values.js';

test('Studio typed defaults preserve native schema defaults through real authenticated HTTP and MySQL', { skip: process.env.YUNCMS_TEST_MYSQL !== '1', timeout: 90000 }, async () => {
  const config = loadConfig(process.env);
  assert.equal(process.env.YUNCMS_TEST_DB_ALLOW_DESTRUCTIVE, '1'); assert.match(config.database.database, /test|ci|dev/i);
  const pool = createDatabasePool(config.database), system = createSystemAccountability(), schema = new SchemaCache();
  const suffix = crypto.randomUUID().replaceAll('-', '').slice(0, 10), collection = `studio_defaults_${suffix}`;
  let server, role, user, created = false;
  try {
    await bootstrapDatabase(pool);
    role = await new RolesService({ database: pool, accountability: system }).createOne({ name: `Studio defaults ${suffix}`, admin: true });
    const password = `Studio-defaults-${suffix}!`;
    user = await new UsersService({ database: pool, accountability: system }).createOne({ email: `studio-${suffix}@example.test`, password, role: role.id });
    const app = createApp({ pool, config, schemaCache: schema, serviceRegistry: createCoreServiceRegistry() });
    server = await new Promise(resolve => { const value = app.listen(0, '127.0.0.1', () => resolve(value)); });
    const origin = `http://127.0.0.1:${server.address().port}`;
    const login = await fetch(origin + '/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: user.email, password }) });
    assert.equal(login.status, 200); const session = (await login.json()).data;
    async function send(path, method = 'GET', body) {
      const response = await fetch(origin + path, { method, headers: { 'content-type': 'application/json', authorization: `Bearer ${session.access_token}` }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
      if (response.status === 204) return null;
      const result = await response.json(); assert.ok(response.ok, `${method} ${path}: ${JSON.stringify(result)}`); return result.data;
    }
    await send('/schema/collections', 'POST', { collection }); created = true;
    for (const field of [
      { field: 'title', type: 'string', required: true },
      { field: 'status', type: 'string', required: true, interface: 'select-dropdown', options: { choices: ['published', 'draft'] }, defaultValue: 'draft' },
      { field: 'enabled', type: 'boolean', required: true, defaultValue: true },
      { field: 'quantity', type: 'integer', required: true, defaultValue: 0 },
    ]) await send(`/schema/collections/${collection}/fields`, 'POST', field);
    const fields = await send(`/schema/collections/${collection}/fields`);
    const payload = Object.fromEntries(fields.filter(field => ['status', 'enabled', 'quantity'].includes(field.field)).map(field => [field.field, outputValueForField(field, inputValueForField(field, undefined))]));
    assert.deepEqual(payload, { status: 'draft', enabled: true, quantity: 0 });
    const record = await send(`/items/${collection}`, 'POST', { title: 'Studio default proof', ...payload });
    const stored = await send(`/items/${collection}/${record.id}`);
    assert.equal(stored.status, 'draft'); assert.equal(Number(stored.enabled), 1); assert.equal(stored.quantity, 0);
    await send(`/items/${collection}/${record.id}`, 'PATCH', { status: 'published', enabled: false });
    const existing = await send(`/items/${collection}/${record.id}`);
    assert.equal(inputValueForField(fields.find(field => field.field === 'status'), existing.status), 'published');
    assert.equal(inputValueForField(fields.find(field => field.field === 'enabled'), existing.enabled), false);
    await send(`/schema/collections/${collection}?destructive=true`, 'DELETE'); created = false;
  } finally {
    if (server) await new Promise(resolve => server.close(resolve));
    if (created) {
      const { CollectionsService } = await import('@yunsoft/yuncms-core');
      await new CollectionsService({ database: pool, accountability: system }).deleteOne(collection, { destructive: true });
    }
    if (user) await pool.query('DELETE FROM yuncms_users WHERE id = ?', [user.id]);
    if (role) await pool.query('DELETE FROM yuncms_roles WHERE id = ?', [role.id]);
    await pool.end();
  }
});
