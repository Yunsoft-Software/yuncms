import assert from 'node:assert/strict';
import { createHash, generateKeyPairSync, randomBytes, sign } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { bootstrapDatabase, createDatabasePool, createFeaturePolicy, createSystemAccountability,
  LocalStorageDriver, createStorageRegistry, loadConfig, RolesService, UsersService } from '@yunsoft/yuncms-core';
import { createApp } from '../../packages/api/src/app.js';

export async function createWhiteLabelFixture() {
  assert.equal(process.env.YUNCMS_TEST_MYSQL, '1');
  assert.equal(process.env.YUNCMS_TEST_DB_ALLOW_DESTRUCTIVE, '1');
  const config = loadConfig(process.env);
  assert.match(config.database.database, /(test|ci|dev)/i);
  assert.ok(['127.0.0.1', 'localhost', '::1'].includes(config.database.host));
  const dbName = 'yuncms_test_white_label_' + randomBytes(6).toString('hex');
  const root = createDatabasePool({ ...config.database, database: undefined });
  await root.query('CREATE DATABASE `' + dbName + '`');
  const database = createDatabasePool({ ...config.database, database: dbName });
  const directory = await mkdtemp(join(tmpdir(), 'yuncms-white-label-'));
  const keys = generateKeyPairSync('ed25519'), publicKey = keys.publicKey.export({ type: 'spki', format: 'pem' });
  const kid = createHash('sha256').update(keys.publicKey.export({ type: 'spki', format: 'der' })).digest('hex').slice(0, 16);
  const featureConfig = { publicKey, domain: 'brand.example.test' };
  const options = { database, accountability: createSystemAccountability(), featurePolicy: createFeaturePolicy(featureConfig) };
  const storage = createStorageRegistry({ local: new LocalStorageDriver({ root: directory }) });
  let server;
  try {
    await bootstrapDatabase(database);
    const password = 'Disposable-white-label-' + randomBytes(12).toString('hex') + '!';
    const roles = new RolesService(options), users = new UsersService(options);
    const adminRole = await roles.createOne({ name: 'Brand administrator', admin: true });
    const staffRole = await roles.createOne({ name: 'Brand staff', admin: false });
    const admin = await users.createOne({ email: 'brand-admin@example.test', password, role: adminRole.id });
    const staff = await users.createOne({ email: 'brand-staff@example.test', password, role: staffRole.id });
    const app = createApp({ pool: database, storage, studioRoot: process.env.YUNCMS_BROWSER_STUDIO_ROOT || undefined,
      config: { ...config, database: { ...config.database, database: dbName }, features: featureConfig } });
    server = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
    const origin = 'http://127.0.0.1:' + server.address().port;
    const request = async (path, { method = 'GET', token, body, form } = {}) => {
      const response = await fetch(origin + path, { method, headers: { ...(token ? { authorization: 'Bearer ' + token } : {}),
        ...(body === undefined ? {} : { 'content-type': 'application/json' }) }, body: form ?? (body === undefined ? undefined : JSON.stringify(body)) });
      const bytes = Buffer.from(await response.arrayBuffer()), text = bytes.toString('utf8');
      return { status: response.status, headers: response.headers, text, bytes,
        body: response.headers.get('content-type')?.includes('application/json') && text ? JSON.parse(text) : null };
    };
    const login = async account => {
      const r = await request('/auth/login', { method: 'POST', body: { email: account.email, password } });
      assert.equal(r.status, 200); return r.body.data;
    };
    const issue = (capabilities = { whiteLabel: true }, patch = {}) => {
      const now = Math.floor(Date.now() / 1000);
      const header = Buffer.from(JSON.stringify({ alg: 'EdDSA', crv: 'Ed25519', typ: 'YUNSOFT-ENTITLEMENT+JWT', kid })).toString('base64url');
      const payload = Buffer.from(JSON.stringify({ iss: 'yunsoft-commerce', sub: 'white-label-fixture', productCode: 'yuncms_premium',
        status: 'active', billingModel: 'one_time_perpetual', iat: now, nbf: now - 1, exp: null,
        allowedHosts: ['brand.example.test'], capabilities, ...patch })).toString('base64url');
      return `${header}.${payload}.${sign(null, Buffer.from(`${header}.${payload}`), keys.privateKey).toString('base64url')}`;
    };
    const upload = async (token, { name = 'client-brand.svg', type = 'image/svg+xml', contents = '<svg xmlns="http://www.w3.org/2000/svg" width="160" height="40"><text x="4" y="26">Acme</text></svg>' } = {}) => {
      const response = await fetch(origin + '/files', { method: 'POST', headers: { authorization: 'Bearer ' + token,
        'content-type': 'application/octet-stream', 'x-mimetype': type,
        'x-filename': type.startsWith('image/') ? name : 'client-document.txt' }, body: Buffer.from(contents) });
      const result = await response.json(); assert.equal(response.status, 201, JSON.stringify(result)); return result.data;
    };
    return { database, dbName, options, featureConfig, storage, directory, origin, request, login, issue, upload, admin, staff, password,
      async close({ preserve = false } = {}) {
        const stopped = new Promise(resolve => server.close(resolve)); server.closeAllConnections(); await stopped;
        await database.end();
        if (!preserve) { await root.query('DROP DATABASE `' + dbName + '`'); await rm(directory, { recursive: true }); }
        await root.end();
      } };
  } catch (error) {
    if (server) { const stopped = new Promise(resolve => server.close(resolve)); server.closeAllConnections(); await stopped; }
    await database.end(); await root.end(); throw error;
  }
}
