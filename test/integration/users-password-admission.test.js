import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { ExtensionError } from '@yunsoft/yuncms-extensions-sdk';
import {
  bootstrapDatabase, createAccountability, createCoreServiceRegistry, createDatabasePool,
  createPublicAccountability, createStorageRegistry, createSystemAccountability, HookEmitter,
  loadConfig, LocalStorageDriver, RolesService, SchemaCache, UsersService,
  withTransaction,
} from '@yunsoft/yuncms-core';
import { createApp } from '../../packages/api/src/app.js';
import { registerInternalAudit } from '../../packages/api/src/audit-hooks.js';
import { verifyPassword } from '../../packages/core/src/auth/password.js';

test('real native password admission protects credentials, sessions and transaction-bound policy writes', {
  skip: process.env.YUNCMS_TEST_MYSQL !== '1', timeout: 90_000,
}, async t => {
  const config = loadConfig(process.env);
  assert.equal(process.env.YUNCMS_TEST_DB_ALLOW_DESTRUCTIVE, '1');
  assert.match(config.database.database, /(test|ci|dev)/i);
  const pool = createDatabasePool({ ...config.database, connectionLimit: 1 });
  const system = createSystemAccountability(), basic = { database: pool, accountability: system };
  const run = randomBytes(5).toString('hex'), policyTable = `it_password_policy_${run}`;
  const root = await mkdtemp(join(tmpdir(), 'yuncms-password-admission-'));
  const roles = [], users = [], filters = [], actions = [], auditErrors = [];
  let server, policyCreated = false;
  t.after(async () => {
    if (server) await new Promise(resolve => server.close(resolve));
    for (const user of users) {
      await pool.query('DELETE FROM yuncms_audit_log WHERE item_key = ?', [user.id]);
      await pool.query('DELETE FROM yuncms_users WHERE id = ?', [user.id]);
    }
    for (const role of roles) await pool.query('DELETE FROM yuncms_roles WHERE id = ?', [role.id]);
    if (policyCreated) await pool.query(`DROP TABLE \`${policyTable}\``);
    await pool.end();
    await rm(root, { recursive: true, force: true });
  });
  await bootstrapDatabase(pool);
  const roleService = new RolesService(basic), userService = new UsersService(basic);
  const adminRole = await roleService.createOne({ name: `Password admin ${run}`, admin: true }); roles.push(adminRole);
  const staffRole = await roleService.createOne({ name: `Password staff ${run}` }); roles.push(staffRole);
  const password = `Initial-${run}-Pass!`, nextPassword = `Changed-${run}-Pass!`;
  const customer = await userService.createOne({ email: `customer-${run}@example.test`, password, role: adminRole.id }); users.push(customer);
  const operator = await userService.createOne({ email: `operator-${run}@example.test`, password, role: staffRole.id }); users.push(operator);
  const staff = await userService.createOne({ email: `staff-${run}@example.test`, password, role: staffRole.id }); users.push(staff);
  await pool.query(`CREATE TABLE \`${policyTable}\` (id INT PRIMARY KEY, attempts INT NOT NULL)`); policyCreated = true;
  await pool.query(`INSERT INTO \`${policyTable}\` VALUES (1, 0)`);
  const logger = { info() {}, warn() {}, error(message) { auditErrors.push(message); } };
  const emitter = new HookEmitter({ logger });
  registerInternalAudit({ emitter, services: createCoreServiceRegistry().toObject(), database: pool, logger });
  emitter.registerFilter('users.password.update', async (payload, context) => {
    assert.deepEqual(Object.keys(payload), ['key']);
    assert.equal(context.collection, 'yuncms_users');
    assert.equal(context.operation, 'update');
    assert.deepEqual(context.transaction, { managed: true, state: 'active' });
    assert.equal(context.before.id, context.key);
    assert.equal(Object.hasOwn(context.before, 'password_hash'), false);
    assert.equal(Object.hasOwn(context.before, 'password'), false);
    filters.push({ key: context.key, actor: context.accountability.user, system: context.accountability.system, requestId: context.requestId });
    await context.database.query(`UPDATE \`${policyTable}\` SET attempts = attempts + 1 WHERE id = 1`);
    if (context.key === operator.id && !context.accountability.system && context.accountability.user !== operator.id) {
      throw new ExtensionError('OPERATOR_USER_PROTECTED', 'Protected operator', { status: 403 });
    }
    // Filter transformations cannot redirect a credential write or replace its password.
    payload.key = customer.id;
    return { key: customer.id, password: 'Extension-forged-password!' };
  });
  emitter.registerAction('users.password.update', (payload, context) => {
    assert.deepEqual(Object.keys(payload), ['key']);
    assert.deepEqual(context.transaction, { managed: true, state: 'committed' });
    actions.push({ key: payload.key, actor: context.accountability.user, requestId: context.requestId });
  });
  const storage = createStorageRegistry({ local: new LocalStorageDriver({ root }) });
  const app = createApp({ pool, config, schemaCache: new SchemaCache({ versionCheckTtlMs: 0 }), storage, emitter, logger });
  server = await new Promise(resolve => { const instance = app.listen(0, '127.0.0.1', () => resolve(instance)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const request = async (path, token, method = 'GET', body, requestId) => {
    const response = await fetch(base + path, { method, headers: {
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(body ? { 'content-type': 'application/json' } : {}),
      ...(requestId ? { 'x-request-id': requestId } : {}),
    }, ...(body ? { body: JSON.stringify(body) } : {}) });
    return { status: response.status, body: response.status === 204 ? null : await response.json() };
  };
  const login = async (user, credential = password) => {
    const result = await request('/auth/login', null, 'POST', { email: user.email, password: credential });
    assert.equal(result.status, 200);
    return result.body.data.access_token;
  };
  const snapshot = async id => {
    const [[user]] = await pool.query('SELECT password_hash FROM yuncms_users WHERE id = ?', [id]);
    const [sessions] = await pool.query('SELECT * FROM yuncms_sessions WHERE user = ? ORDER BY id', [id]);
    return { hash: user.password_hash, sessions };
  };
  const attempts = async () => { const [[row]] = await pool.query(`SELECT attempts FROM \`${policyTable}\` WHERE id = 1`); return row.attempts; };
  const auditCount = async id => { const [[row]] = await pool.query('SELECT COUNT(*) AS total FROM yuncms_audit_log WHERE item_key = ? AND action = ?', [id, 'users.password.update']); return Number(row.total); };
  const customerActor = createAccountability({ user: customer.id, role: adminRole.id, admin: true });
  const customerToken = await login(customer), operatorToken = await login(operator), staffToken = await login(staff);

  let protectedCredentialsVerified = false;
  await t.test('protected operator native HTTP returns 403 and preserves password, sessions and policy writes', async () => {
    const before = await snapshot(operator.id), count = await attempts();
    const result = await request(`/users/${operator.id}/password`, customerToken, 'PATCH', { password: nextPassword }, `password-denied-${run}`);
    assert.equal(result.status, 403);
    assert.equal(result.body.errors[0].code, 'OPERATOR_USER_PROTECTED');
    assert.deepEqual(await snapshot(operator.id), before);
    assert.equal(await attempts(), count); assert.equal(actions.length, 0); assert.equal(await auditCount(operator.id), 0);
    assert.equal(filters.at(-1).actor, customer.id); assert.equal(filters.at(-1).key, operator.id);
    assert.equal(filters.at(-1).requestId, `password-denied-${run}`);
    protectedCredentialsVerified = true;
  });
  // A failed baseline must stop before later scenarios depend on preserved credentials.
  if (!protectedCredentialsVerified) return;

  await t.test('direct public service obeys the same operator policy', async () => {
    const before = await snapshot(operator.id), count = await attempts();
    await assert.rejects(new UsersService({ ...basic, accountability: customerActor, emitter }).updatePassword(operator.id, nextPassword), { code: 'OPERATOR_USER_PROTECTED', status: 403 });
    assert.deepEqual(await snapshot(operator.id), before); assert.equal(await attempts(), count); assert.equal(actions.length, 0);
  });
  await t.test('anonymous and delegated callers cannot enter admission for foreign passwords', async () => {
    const before = await snapshot(operator.id), count = filters.length;
    for (const token of [null, staffToken]) assert.equal((await request(`/users/${operator.id}/password`, token, 'PATCH', { password: nextPassword })).status, 403);
    for (const accountability of [createPublicAccountability(), createAccountability({ user: staff.id, role: staffRole.id })]) {
      await assert.rejects(new UsersService({ ...basic, accountability, emitter }).updatePassword(operator.id, nextPassword), { code: 'FORBIDDEN' });
    }
    assert.equal(filters.length, count); assert.deepEqual(await snapshot(operator.id), before);
  });
  await t.test('invalid native HTTP password is rejected before policy writes', async () => {
    const count = filters.length;
    const result = await request(`/users/${operator.id}/password`, customerToken, 'PATCH', { password: 'short' });
    assert.equal(result.status, 400); assert.equal(result.body.errors[0].code, 'INVALID_PASSWORD'); assert.equal(filters.length, count);
  });
  await t.test('outer transaction rollback restores password, sessions, policy writes and suppresses audit', async () => {
    const before = await snapshot(operator.id), count = await attempts();
    await assert.rejects(withTransaction(pool, async database => {
      await new UsersService({ ...basic, database, emitter }).updatePassword(operator.id, nextPassword);
      assert.equal(actions.length, 0); throw Error('Outer business failure');
    }), /Outer business failure/);
    assert.deepEqual(await snapshot(operator.id), before); assert.equal(await attempts(), count); assert.equal(actions.length, 0); assert.equal(await auditCount(operator.id), 0);
  });
  await t.test('self password change ignores forged filter output, revokes sessions and audits after commit', async () => {
    const customerBefore = await snapshot(customer.id), count = await attempts();
    assert.equal((await request(`/users/${operator.id}/password`, operatorToken, 'PATCH', { password: nextPassword }, `password-self-${run}`)).status, 204);
    const after = await snapshot(operator.id);
    assert.equal(await verifyPassword(nextPassword, after.hash), true); assert.equal(after.sessions.length, 0);
    assert.deepEqual(await snapshot(customer.id), customerBefore); assert.equal(await attempts(), count + 1);
    assert.equal((await request(`/users/${operator.id}`, operatorToken)).status, 401);
    await login(operator, nextPassword);
    assert.equal(actions.length, 1); assert.equal(actions[0].key, operator.id); assert.equal(actions[0].actor, operator.id);
    assert.equal(await auditCount(operator.id), 1);
  });
  await t.test('explicit system operation consults admission and revokes the new session', async () => {
    assert.equal(await new UsersService({ ...basic, emitter }).updatePassword(operator.id, password), true);
    assert.equal(filters.at(-1).system, true); assert.equal((await snapshot(operator.id)).sessions.length, 0);
    assert.equal(actions.length, 2); assert.equal(await auditCount(operator.id), 2);
  });
  await t.test('administrator can change an unprotected user password', async () => {
    assert.equal((await request(`/users/${staff.id}/password`, customerToken, 'PATCH', { password: nextPassword })).status, 204);
    const after = await snapshot(staff.id);
    assert.equal(await verifyPassword(nextPassword, after.hash), true); assert.equal(after.sessions.length, 0);
    assert.equal(actions.at(-1).key, staff.id); assert.equal(await auditCount(staff.id), 1);
  });
  assert.deepEqual(auditErrors, []);
});
