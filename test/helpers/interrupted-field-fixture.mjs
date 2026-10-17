import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import {
  bootstrapDatabase, createDatabasePool, createSystemAccountability, loadConfig,
  CollectionsService, FieldsService, ItemsService, RolesService, UsersService,
  HookEmitter, SchemaCache, LocalStorageDriver, createStorageRegistry,
} from '@yunsoft/yuncms-core';
import { createApp } from '../../packages/api/src/app.js';

export async function createInterruptedFieldFixture() {
  assert.equal(process.env.YUNCMS_TEST_MYSQL, '1');
  assert.equal(process.env.YUNCMS_TEST_DB_ALLOW_DESTRUCTIVE, '1');
  const config = loadConfig(process.env);
  assert.match(config.database.database, /(test|ci|dev)/i);
  const nonce = randomBytes(6).toString('hex'), dbName = 'yuncms_test_recovery_' + nonce;
  const rootPool = createDatabasePool({ ...config.database, database: undefined });
  await rootPool.query('CREATE DATABASE `' + dbName + '`');
  const database = createDatabasePool({ ...config.database, database: dbName, connectionLimit: 5 });
  const options = { database, accountability: createSystemAccountability() };
  const fields = new FieldsService(options), schemaCache = new SchemaCache({ versionCheckTtlMs: 0 });
  const directory = await mkdtemp(join(tmpdir(), 'yuncms-field-recovery-'));
  let server;
  try {
    await bootstrapDatabase(database);
    await new CollectionsService(options).createOne({ collection: 'recovery_records' });
    await fields.createOne('recovery_records', { field: 'title', type: 'string' });
    const row = await new ItemsService('recovery_records', { ...options, schemaCache }).createOne({ title: 'Existing data survives' });
    const roles = new RolesService(options), users = new UsersService(options);
    const adminRole = await roles.createOne({ name: 'Recovery administrator', admin: true });
    const staffRole = await roles.createOne({ name: 'Recovery staff', admin: false });
    const password = 'Recovery-' + nonce + '-Password!';
    const admin = await users.createOne({ email: 'admin-' + nonce + '@example.test', password, role: adminRole.id });
    const staff = await users.createOne({ email: 'staff-' + nonce + '@example.test', password, role: staffRole.id });
    const emitter = new HookEmitter();
    const app = createApp({ pool: database, config: { ...config, database: { ...config.database, database: dbName } },
      schemaCache, emitter, storage: createStorageRegistry({ local: new LocalStorageDriver({ root: directory }) }) });
    server = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
    const origin = 'http://127.0.0.1:' + server.address().port;
    const request = async (path, { token, method = 'GET', body } = {}) => {
      const response = await fetch(origin + path, { method,
        headers: { ...(token ? { authorization: 'Bearer ' + token } : {}), ...(body ? { 'content-type': 'application/json' } : {}) },
        ...(body ? { body: JSON.stringify(body) } : {}) });
      return { status: response.status, body: response.status === 204 ? null : await response.json() };
    };
    const login = async user => {
      const result = await request('/auth/login', { method: 'POST', body: { email: user.email, password } });
      assert.equal(result.status, 200); return result.body.data.access_token;
    };
    const version = async () => Number((await database.query('SELECT version FROM yuncms_schema_state WHERE id=1'))[0][0].version);
    const interrupt = async (definition = { field: 'content', type: 'text' }) => {
      const lock = await database.getConnection();
      let child;
      try {
        await lock.beginTransaction();
        await lock.query('SELECT version FROM yuncms_schema_state WHERE id=1 FOR UPDATE');
        child = spawn(process.execPath, [join(import.meta.dirname, '../integration/fixtures/interrupted-field-worker.mjs')], {
          env: { ...process.env, DB_DATABASE: dbName, YUNCMS_INTERRUPTED_FIELD: JSON.stringify(definition) }, stdio: 'ignore',
        });
        const exited = once(child, 'exit');
        let physical = false;
        for (let n = 0; n < 200 && child.exitCode === null; n++) {
          const [columns] = await database.query('SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=? AND TABLE_NAME=? AND COLUMN_NAME=?', [dbName, 'recovery_records', definition.field]);
          if (columns.length) { physical = true; break; }
          await delay(25);
        }
        assert.equal(physical, true, 'Native worker must complete real ALTER before the interruption');
        const [uncommitted] = await database.query('SELECT id FROM yuncms_fields WHERE collection=? AND field=?', ['recovery_records', definition.field]);
        assert.equal(uncommitted.length, 0, 'Metadata transaction must still be uncommitted');
        child.kill('SIGKILL');
        const [, signal] = await exited;
        assert.equal(signal, 'SIGKILL');
      } finally {
        if (child?.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
        await lock.rollback(); lock.release();
      }
      assert.equal(await fields.readOne('recovery_records', definition.field), null);
      return { definition, signal: 'SIGKILL', physicalColumnPreserved: true, nativeMetadataMissing: true };
    };
    return { database, dbName, fields, options, row, origin, request, login, admin, staff, password, emitter, version, interrupt,
      close: async ({ preserve = false } = {}) => {
        await new Promise(resolve => server.close(resolve)); await database.end();
        if (!preserve) await rootPool.query('DROP DATABASE `' + dbName + '`');
        await rootPool.end(); await rm(directory, { recursive: true, force: true });
      } };
  } catch (error) {
    if (server) await new Promise(resolve => server.close(resolve));
    await database.end(); await rootPool.end(); await rm(directory, { recursive: true, force: true });
    throw error;
  }
}
