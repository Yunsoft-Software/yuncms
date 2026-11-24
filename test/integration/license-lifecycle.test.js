import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash, generateKeyPairSync, randomBytes, sign } from 'node:crypto';
import { createServer } from 'node:http';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  bootstrapDatabase, CollectionsService, ContentRevisionsService, createDatabasePool,
  createFeaturePolicy, createStorageRegistry, createSystemAccountability, FeaturesService,
  FieldsService, LocalStorageDriver, loadConfig, OFFICIAL_LICENSE_KEY_ID, PermissionsService, RolesService, UsersService,
} from '@yunsoft/yuncms-core';
import { createApp } from '../../packages/api/src/app.js';
import { runInitCommand } from '../../packages/cli/src/init-command.js';

test('real MySQL/HTTP: monthly_term (1m/12m), perpetual, host/instance binding, expiry continuity, renewal persistence and anti-replay under native RBAC', {
  skip: process.env.YUNCMS_TEST_MYSQL !== '1', timeout: 90_000,
}, async t => {
  assert.equal(process.env.YUNCMS_TEST_DB_ALLOW_DESTRUCTIVE, '1');
  const baseConfig = loadConfig(process.env);
  assert.match(baseConfig.database.database, /(test|ci|dev)/i);
  assert.ok(['127.0.0.1', 'localhost', '::1'].includes(baseConfig.database.host));

  const dbName = 'yuncms_test_license_' + randomBytes(6).toString('hex');
  const rootPool = createDatabasePool({ ...baseConfig.database, database: undefined });
  await rootPool.query('CREATE DATABASE `' + dbName + '`');
  const database = createDatabasePool({ ...baseConfig.database, database: dbName });
  const storageDir = await mkdtemp(join(tmpdir(), 'yuncms-license-test-'));
  const storage = createStorageRegistry({ local: new LocalStorageDriver({ root: storageDir }) });

  // Ephemeral fixture-only Ed25519 signing keys (never production keys)
  const keys = generateKeyPairSync('ed25519');
  const wrongKeys = generateKeyPairSync('ed25519');
  const publicKey = keys.publicKey.export({ type: 'spki', format: 'pem' });
  const kid = createHash('sha256').update(keys.publicKey.export({ type: 'spki', format: 'der' })).digest('hex').slice(0, 16);
  const instanceId = 'yuncms-disposable-instance-01';
  const featureConfig = { publicKey, domain: 'api.cms.example.test', instanceId };
  const systemOptions = { database, storage, accountability: createSystemAccountability(), featurePolicy: createFeaturePolicy(featureConfig) };

  let server;
  let accepted = false;
  try {
    await bootstrapDatabase(database);
    const password = 'Disposable-License-' + randomBytes(10).toString('hex') + '!';
    const roles = new RolesService(systemOptions);
    const users = new UsersService(systemOptions);
    const adminRole = await roles.createOne({ name: 'License Admin', admin: true });
    const editorRole = await roles.createOne({ name: 'Community Editor', admin: false });
    const adminUser = await users.createOne({ email: 'license-admin@example.test', password, role: adminRole.id });
    const editorUser = await users.createOne({ email: 'community-editor@example.test', password, role: editorRole.id });

    const collection = 'articles';
    await new CollectionsService(systemOptions).createOne({
      collection,
      metadata: { contentTracking: { enabled: true, history: true } },
    });
    await new FieldsService(systemOptions).createOne(collection, { field: 'title', type: 'string', required: true });
    for (const action of ['create', 'read', 'update', 'delete']) {
      await new PermissionsService(systemOptions).createOne({
        role: editorRole.id,
        collection,
        action,
        fields: ['id', 'title'],
      });
    }

    const app = createApp({
      pool: database,
      storage,
      config: {
        ...baseConfig,
        database: { ...baseConfig.database, database: dbName },
        features: featureConfig,
        server: { ...baseConfig.server, rateLimit: { enabled: false }, pressure: { enabled: false } },
      },
      logger: { error() {}, warn() {}, info() {} },
    });
    server = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
    const origin = 'http://127.0.0.1:' + server.address().port;

    const request = async (path, { method = 'GET', token, body } = {}) => {
      const response = await fetch(origin + path, {
        method,
        headers: {
          ...(token ? { authorization: 'Bearer ' + token } : {}),
          ...(body === undefined ? {} : { 'content-type': 'application/json' }),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      const text = await response.text();
      return { status: response.status, body: text ? JSON.parse(text) : null };
    };

    const login = async email => {
      const res = await request('/auth/login', { method: 'POST', body: { email, password } });
      assert.equal(res.status, 200);
      return res.body.data.access_token;
    };

    const adminToken = await login(adminUser.email);
    const editorToken = await login(editorUser.email);

    const signToken = (patch = {}, { signingKey = keys.privateKey, headerPatch = {} } = {}) => {
      const now = Math.floor(Date.now() / 1000);
      const header = Buffer.from(JSON.stringify({
        alg: 'EdDSA', crv: 'Ed25519', typ: 'YUNSOFT-ENTITLEMENT+JWT', kid, ...headerPatch,
      })).toString('base64url');
      const payload = Buffer.from(JSON.stringify({
        iss: 'yunsoft-commerce',
        sub: 'lic-cms-001',
        licenseId: 'lic-cms-001',
        productCode: 'yuncms_premium',
        status: 'active',
        billingModel: 'monthly_term',
        periodMonths: 1,
        entitlementVersion: 1,
        iat: now,
        nbf: now - 5,
        exp: now + 30 * 86400,
        normalizedDomain: 'cms.example.test',
        allowedHosts: ['cms.example.test', 'www.cms.example.test', 'api.cms.example.test'],
        stagingHosts: ['staging.cms.example.test', 'localhost', '127.0.0.1'],
        activatedInstanceId: instanceId,
        capabilities: {
          aiAssistant: true, aiFlows: true, mcp: true, flowScripts: true,
          contentHistory: true, whiteLabel: true,
        },
        ...patch,
      })).toString('base64url');
      return `${header}.${payload}.${sign(null, Buffer.from(`${header}.${payload}`), signingKey).toString('base64url')}`;
    };

    let createdArticleId;

    await t.test('native RBAC protects license endpoints and rejects forged, expired, future-nbf, wrong-product, wrong-domain and wrong-instance tokens', async () => {
      assert.equal((await request('/features')).status, 401);
      assert.equal((await request('/features/license', { method: 'POST', body: { token: signToken() } })).status, 403);
      assert.equal((await request('/features/license', { method: 'POST', token: editorToken, body: { token: signToken() } })).status, 403);

      const editorFeatures = await request('/features', { token: editorToken });
      assert.equal(editorFeatures.status, 200);
      assert.equal(Object.hasOwn(editorFeatures.body.data, 'license'), false);

      const now = Math.floor(Date.now() / 1000);
      const invalidCandidates = [
        signToken({}, { signingKey: wrongKeys.privateKey }),
        signToken({ exp: now - 10 }),
        signToken({ nbf: now + 3600 }),
        signToken({ productCode: 'yunpanel_premium' }),
        signToken({ allowedHosts: ['other.example.test'], stagingHosts: [] }),
        signToken({ activatedInstanceId: 'different-instance-id' }),
        signToken({ billingModel: 'monthly_term', exp: null }),
      ];
      for (const badToken of invalidCandidates) {
        const res = await request('/features/license', { method: 'POST', token: adminToken, body: { token: badToken } });
        assert.equal(res.status, 400);
        assert.equal(res.body.errors[0].code, 'INVALID_LICENSE');
      }

      const [rows] = await database.query('SELECT * FROM yuncms_license_state');
      assert.equal(rows.length, 0);
    });

    await t.test('1-month monthly_term activates persistently on API host + instance binding and unlocks Premium without leaking token', async () => {
      const v1Monthly = signToken({ periodMonths: 1, entitlementVersion: 1 });
      const res = await request('/features/license', { method: 'POST', token: adminToken, body: { token: `  ${v1Monthly}\n` } });
      assert.equal(res.status, 200);
      assert.equal(JSON.stringify(res.body).includes(v1Monthly), false);
      assert.equal(res.body.data.license.status, 'active');
      assert.equal(res.body.data.license.domain, 'api.cms.example.test');
      assert.equal(res.body.data.license.billingModel, 'monthly_term');
      assert.equal(res.body.data.license.periodMonths, 1);
      assert.equal(res.body.data.license.entitlementVersion, 1);
      assert.ok(res.body.data.license.expiresAt);
      assert.equal(res.body.data.features.contentHistory.enabled, true);
      assert.equal(res.body.data.features.whiteLabel.allowed, true);
      assert.equal(res.body.data.features.whiteLabel.enabled, false);

      // Enable opt-in white-label and customize brand, plus create/update Community data so revision 1 & 2 are recorded.
      assert.equal((await request('/features/whiteLabel', { method: 'PATCH', token: adminToken, body: { enabled: true } })).status, 200);
      assert.equal((await request('/studio-settings', { method: 'PATCH', token: adminToken, body: { brand_name: 'Client Portal' } })).status, 200);

      const created = await request(`/items/${collection}`, { method: 'POST', token: editorToken, body: { title: 'Month 1 initial' } });
      assert.equal(created.status, 201);
      createdArticleId = created.body.data.id;
      assert.equal((await request(`/items/${collection}/${createdArticleId}`, { method: 'PATCH', token: editorToken, body: { title: 'Month 1 updated' } })).status, 200);

      // Fresh service instance reads persisted activation from MySQL (simulating process restart) and staging host policy also verifies cleanly.
      const freshService = new FeaturesService(systemOptions);
      const freshStatus = await freshService.readStatus();
      assert.equal(freshStatus.license.status, 'active');
      assert.equal(freshStatus.features.whiteLabel.enabled, true);

      const stagingPolicy = createFeaturePolicy({ publicKey, domain: 'staging.cms.example.test', instanceId, token: v1Monthly });
      assert.equal(stagingPolicy.licenseStatus().status, 'active');
      assert.equal(stagingPolicy.licenseStatus().domain, 'staging.cms.example.test');

      const [audits] = await database.query("SELECT payload FROM yuncms_audit_log WHERE action = 'features.activate'");
      assert.equal(audits.length, 1);
      assert.equal(JSON.stringify(audits[0]).includes('YUNSOFT-ENTITLEMENT+JWT'), false);
    });

    await t.test('expired term license closes Premium gates while preserving Community CRUD, existing data, revisions and white-label settings', async () => {
      const now = Math.floor(Date.now() / 1000);
      const expiredV1 = signToken({ periodMonths: 1, entitlementVersion: 1, iat: now - 7200, nbf: now - 7200, exp: now - 60 });
      await database.query('UPDATE yuncms_license_state SET token = ? WHERE id = 1', [expiredV1]);

      const statusRes = await request('/features', { token: adminToken });
      assert.equal(statusRes.status, 200);
      assert.equal(statusRes.body.data.license.status, 'expired');
      assert.equal(statusRes.body.data.license.periodMonths, 1);
      assert.equal(statusRes.body.data.features.contentHistory.enabled, false);
      assert.equal(statusRes.body.data.features.whiteLabel.enabled, false);

      // Public settings revert to Community identity while preserving DB row.
      const pubSettings = await request('/studio-settings');
      assert.equal(pubSettings.body.data.brand_name, 'YunCMS');
      assert.equal(pubSettings.body.data.premium, false);

      // Premium revision history is gated, NOT deleted.
      const revDenied = await request(`/items/${collection}/${createdArticleId}/revisions`, { token: adminToken });
      assert.equal(revDenied.status, 403);
      assert.equal(revDenied.body.errors[0].code, 'FEATURE_NOT_LICENSED');

      // Community CRUD (read, create, update, delete) continues unobstructed for editors!
      const readRes = await request(`/items/${collection}/${createdArticleId}`, { token: editorToken });
      assert.equal(readRes.status, 200);
      assert.equal(readRes.body.data.title, 'Month 1 updated');

      const patchRes = await request(`/items/${collection}/${createdArticleId}`, {
        method: 'PATCH', token: editorToken, body: { title: 'Edited during expired Premium' },
      });
      assert.equal(patchRes.status, 200);

      const extra = await request(`/items/${collection}`, { method: 'POST', token: editorToken, body: { title: 'Temporary Community item' } });
      assert.equal(extra.status, 201);
      assert.equal((await request(`/items/${collection}/${extra.body.data.id}`, { method: 'DELETE', token: editorToken })).status, 204);
    });

    await t.test('12-month renewed token restores Premium and blocks stale v1 replay; existing perpetual grants remain compatible', async () => {
      const now = Math.floor(Date.now() / 1000);
      const unexpiredOldV1 = signToken({ periodMonths: 1, entitlementVersion: 1, iat: now, exp: now + 10 * 86400 });
      const renewedAnnualV2 = signToken({ periodMonths: 12, entitlementVersion: 2, iat: now + 2, exp: now + 365 * 86400 });

      const activatedV2 = await request('/features/license', { method: 'POST', token: adminToken, body: { token: renewedAnnualV2 } });
      assert.equal(activatedV2.status, 200);
      assert.equal(activatedV2.body.data.license.status, 'active');
      assert.equal(activatedV2.body.data.license.billingModel, 'monthly_term');
      assert.equal(activatedV2.body.data.license.periodMonths, 12);
      assert.equal(activatedV2.body.data.license.entitlementVersion, 2);
      assert.equal(activatedV2.body.data.features.contentHistory.enabled, true);
      assert.equal(activatedV2.body.data.features.whiteLabel.enabled, true);

      // Saved custom branding and earlier revisions are intact and active again!
      assert.equal((await request('/studio-settings')).body.data.brand_name, 'Client Portal');
      const revisions = await new ContentRevisionsService(collection, systemOptions).readRevisions(createdArticleId);
      assert.equal(revisions.length, 2);

      // Attempting to replay the older unexpired v1 token must fail and preserve v2 in MySQL!
      const replayRes = await request('/features/license', { method: 'POST', token: adminToken, body: { token: unexpiredOldV1 } });
      assert.equal(replayRes.status, 400);
      assert.equal(replayRes.body.errors[0].code, 'INVALID_LICENSE');
      const afterReplay = await request('/features', { token: adminToken });
      assert.equal(afterReplay.body.data.license.entitlementVersion, 2);
      assert.equal(afterReplay.body.data.license.periodMonths, 12);

      // Perpetual entitlement compatibility (e.g. legacy or new licenseId perpetual grant)
      const perpetual = signToken({
        sub: 'lic-cms-perpetual', licenseId: 'lic-cms-perpetual',
        billingModel: 'one_time_perpetual', periodMonths: null, entitlementVersion: 1, exp: null,
      });
      const perpRes = await request('/features/license', { method: 'POST', token: adminToken, body: { token: perpetual } });
      assert.equal(perpRes.status, 200);
      assert.equal(perpRes.body.data.license.billingModel, 'one_time_perpetual');
      assert.equal(perpRes.body.data.license.periodMonths, null);
      assert.equal(perpRes.body.data.license.expiresAt, null);
    });

    await t.test('clean installation resolves non-local AUTH_PUBLIC_URL domain, enforces official default trust anchor, blocks localhost/Host-header leaks and rejects short licenseKey strings', async () => {
      await database.query('DELETE FROM yuncms_license_state');
      const runCleanServer = async envOverrides => {
        const cleanConfig = loadConfig({
          DB_HOST: baseConfig.database.host,
          DB_PORT: String(baseConfig.database.port),
          DB_DATABASE: dbName,
          DB_USER: baseConfig.database.user,
          DB_PASSWORD: baseConfig.database.password,
          API_RATE_LIMIT_ENABLED: '0',
          PRESSURE_LIMIT_ENABLED: '0',
          ...envOverrides,
        });
        const cleanApp = createApp({
          pool: database,
          storage,
          config: cleanConfig,
          logger: { error() {}, warn() {}, info() {} },
        });
        const s = await new Promise(resolve => { const srv = cleanApp.listen(0, '127.0.0.1', () => resolve(srv)); });
        const url = 'http://127.0.0.1:' + s.address().port;
        const call = async (path, { method = 'GET', token, body, extraHeaders = {} } = {}) => {
          const response = await fetch(url + path, {
            method,
            headers: {
              ...(token ? { authorization: 'Bearer ' + token } : {}),
              ...(body === undefined ? {} : { 'content-type': 'application/json' }),
              ...extraHeaders,
            },
            body: body === undefined ? undefined : JSON.stringify(body),
          });
          const text = await response.text();
          return { status: response.status, body: text ? JSON.parse(text) : null };
        };
        const close = async () => {
          const done = new Promise(resolve => s.close(resolve));
          s.closeAllConnections();
          await done;
        };
        return { cleanConfig, call, close };
      };

      // 1) Unconfigured default localhost install (zero YUNCMS_LICENSE_* and default http://localhost:3008):
      //    must NOT auto-derive localhost, must ignore Host/X-Forwarded-Host headers, and must reject short portal licenseKey strings.
      const unconfigured = await runCleanServer({});
      try {
        assert.equal(unconfigured.cleanConfig.features.publicKey, null);
        assert.equal(unconfigured.cleanConfig.features.domain, null);
        const initial = await unconfigured.call('/features', { token: adminToken });
        assert.equal(initial.status, 200);
        assert.deepEqual(initial.body.data.license, { status: 'missing' });

        const shortKeyRes = await unconfigured.call('/features/license', {
          method: 'POST',
          token: adminToken,
          body: { token: 'YCMS-2026-PORTAL-SHORT-KEY' },
        });
        assert.equal(shortKeyRes.status, 400);
        assert.equal(shortKeyRes.body.errors[0].code, 'INVALID_LICENSE');
        assert.match(shortKeyRes.body.errors[0].message, /three-part signed entitlement token \(JWT\)/);

        const localhostLeakToken = signToken({
          activatedInstanceId: null,
          allowedHosts: ['cms.example.test'],
          stagingHosts: ['localhost', '127.0.0.1'],
        });
        const leakRes = await unconfigured.call('/features/license', {
          method: 'POST',
          token: adminToken,
          extraHeaders: { 'x-forwarded-host': 'cms.example.test' },
          body: { token: localhostLeakToken },
        });
        assert.equal(leakRes.status, 400);
        assert.equal(leakRes.body.errors[0].code, 'INVALID_LICENSE');
        assert.match(leakRes.body.errors[0].message, /AUTH_PUBLIC_URL, STUDIO_ORIGIN or YUNCMS_LICENSE_DOMAIN/);
      } finally {
        await unconfigured.close();
      }

      // 2) Zero-YUNCMS_LICENSE_* production install with AUTH_PUBLIC_URL set:
      //    uses embedded official Yunsoft Ed25519 trust anchor (1cbcc4d3173d0c15) and exposes configuredDomain.
      const defaultAnchor = await runCleanServer({ AUTH_PUBLIC_URL: 'https://cms.clean.example.test' });
      try {
        assert.equal(defaultAnchor.cleanConfig.features.publicKey, null);
        assert.equal(defaultAnchor.cleanConfig.features.domain, 'cms.clean.example.test');
        const statusRes = await defaultAnchor.call('/features', { token: adminToken });
        assert.deepEqual(statusRes.body.data.license, {
          status: 'missing',
          configuredDomain: 'cms.clean.example.test',
        });

        const spoofedOfficialKid = signToken(
          { activatedInstanceId: null, allowedHosts: ['cms.clean.example.test'] },
          { headerPatch: { kid: OFFICIAL_LICENSE_KEY_ID } },
        );
        const forgedRes = await defaultAnchor.call('/features/license', {
          method: 'POST',
          token: adminToken,
          body: { token: spoofedOfficialKid },
        });
        assert.equal(forgedRes.status, 400);
        assert.equal(forgedRes.body.errors[0].code, 'INVALID_LICENSE');
      } finally {
        await defaultAnchor.close();
      }

      // 3) Clean installation domain derivation (YUNCMS_LICENSE_DOMAIN unset, AUTH_PUBLIC_URL set)
      //    activates 1m and 12m JWTs persistently while rejecting wrong-domain + Host-header spoofing + stale replay.
      const cleanDomain = await runCleanServer({
        AUTH_PUBLIC_URL: 'https://cms.clean.example.test',
        YUNCMS_LICENSE_PUBLIC_KEY: publicKey,
      });
      try {
        assert.equal(cleanDomain.cleanConfig.features.domain, 'cms.clean.example.test');
        const wrongHostToken = signToken({
          activatedInstanceId: null,
          allowedHosts: ['evil.example.test'],
          stagingHosts: [],
        });
        const wrongHostRes = await cleanDomain.call('/features/license', {
          method: 'POST',
          token: adminToken,
          extraHeaders: { 'x-forwarded-host': 'evil.example.test' },
          body: { token: wrongHostToken },
        });
        assert.equal(wrongHostRes.status, 400);

        const now = Math.floor(Date.now() / 1000);
        const cleanMonthly = signToken({
          sub: 'lic-clean-install',
          licenseId: 'lic-clean-install',
          billingModel: 'monthly_term',
          periodMonths: 1,
          entitlementVersion: 1,
          iat: now,
          exp: now + 30 * 86400,
          activatedInstanceId: null,
          allowedHosts: ['cms.clean.example.test'],
          stagingHosts: ['localhost', '127.0.0.1'],
        });
        const monthRes = await cleanDomain.call('/features/license', {
          method: 'POST',
          token: adminToken,
          body: { token: cleanMonthly },
        });
        assert.equal(monthRes.status, 200);
        assert.equal(monthRes.body.data.license.status, 'active');
        assert.equal(monthRes.body.data.license.domain, 'cms.clean.example.test');
        assert.equal(monthRes.body.data.license.periodMonths, 1);
        assert.equal(monthRes.body.data.features.contentHistory.enabled, true);

        const cleanAnnual = signToken({
          sub: 'lic-clean-install',
          licenseId: 'lic-clean-install',
          billingModel: 'monthly_term',
          periodMonths: 12,
          entitlementVersion: 2,
          iat: now + 2,
          exp: now + 365 * 86400,
          activatedInstanceId: null,
          allowedHosts: ['cms.clean.example.test'],
          stagingHosts: ['localhost', '127.0.0.1'],
        });
        const annualRes = await cleanDomain.call('/features/license', {
          method: 'POST',
          token: adminToken,
          body: { token: cleanAnnual },
        });
        assert.equal(annualRes.status, 200);
        assert.equal(annualRes.body.data.license.periodMonths, 12);
        assert.equal(annualRes.body.data.license.entitlementVersion, 2);

        const replayOld = await cleanDomain.call('/features/license', {
          method: 'POST',
          token: adminToken,
          body: { token: cleanMonthly },
        });
        assert.equal(replayOld.status, 400);
        assert.equal(replayOld.body.errors[0].code, 'INVALID_LICENSE');
      } finally {
        await cleanDomain.close();
      }
    });

    await t.test('optional 3-month Premium offer (local safe target, zero outbound requests, admin-only) and monthly_term periodMonths=3 activation/expiry + native CLI init opt-in/skip', async () => {
      await database.query('DELETE FROM yuncms_license_state');
      const offerHits = [];
      const offerServer = createServer((req, res) => {
        offerHits.push({ method: req.method, url: req.url, referer: req.headers.referer ?? null });
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
        res.end('<!doctype html><title>Local Premium Offer</title><h1>3-month Premium Offer</h1>');
      });
      await new Promise(resolve => offerServer.listen(0, '127.0.0.1', resolve));
      const localOfferUrl = `http://127.0.0.1:${offerServer.address().port}/premium-offer`;

      const runOfferServer = async envOverrides => {
        const offerConfig = loadConfig({
          DB_HOST: baseConfig.database.host,
          DB_PORT: String(baseConfig.database.port),
          DB_DATABASE: dbName,
          DB_USER: baseConfig.database.user,
          DB_PASSWORD: baseConfig.database.password,
          API_RATE_LIMIT_ENABLED: '0',
          PRESSURE_LIMIT_ENABLED: '0',
          AUTH_PUBLIC_URL: 'https://cms.clean.example.test',
          YUNCMS_LICENSE_PUBLIC_KEY: publicKey,
          ...envOverrides,
        });
        const offerApp = createApp({
          pool: database,
          storage,
          config: offerConfig,
          logger: { error() {}, warn() {}, info() {} },
        });
        const srv = await new Promise(resolve => { const s = offerApp.listen(0, '127.0.0.1', () => resolve(s)); });
        const url = 'http://127.0.0.1:' + srv.address().port;
        const call = async (path, { method = 'GET', token, body } = {}) => {
          const response = await fetch(url + path, {
            method,
            headers: {
              ...(token ? { authorization: 'Bearer ' + token } : {}),
              ...(body === undefined ? {} : { 'content-type': 'application/json' }),
            },
            body: body === undefined ? undefined : JSON.stringify(body),
          });
          const text = await response.text();
          return { status: response.status, body: text ? JSON.parse(text) : null };
        };
        const close = async () => {
          const done = new Promise(resolve => srv.close(resolve));
          srv.closeAllConnections();
          await done;
        };
        return { call, close };
      };

      try {
        // 1) Default (unset YUNCMS_PREMIUM_OFFER_URL) omits premiumOffer completely
        const withoutOffer = await runOfferServer({});
        try {
          const adminRes = await withoutOffer.call('/features', { token: adminToken });
          assert.equal(adminRes.status, 200);
          assert.equal(Object.hasOwn(adminRes.body.data, 'premiumOffer'), false);
        } finally {
          await withoutOffer.close();
        }

        // 2) Configured safe local target: admin sees exact URL before activation, non-admin never sees it,
        //    zero outbound HTTP calls occur, and activating periodMonths=3 hides premiumOffer and unlocks Premium.
        const withOffer = await runOfferServer({ YUNCMS_PREMIUM_OFFER_URL: localOfferUrl });
        try {
          const editorRes = await withOffer.call('/features', { token: editorToken });
          assert.equal(editorRes.status, 200);
          assert.equal(Object.hasOwn(editorRes.body.data, 'premiumOffer'), false);
          assert.equal(Object.hasOwn(editorRes.body.data, 'license'), false);

          const adminBefore = await withOffer.call('/features', { token: adminToken });
          assert.equal(adminBefore.status, 200);
          assert.deepEqual(adminBefore.body.data.premiumOffer, { url: localOfferUrl });
          assert.equal(offerHits.length, 0);

          const now = Math.floor(Date.now() / 1000);
          const exp3m = now + 90 * 86400;
          const iso3m = new Date(exp3m * 1000).toISOString();

          // Reject a missing exp, wrong domain, tampered signature, or expired 3-month token.
          for (const rejected of [
            signToken({ billingModel: 'monthly_term', periodMonths: 3, exp: null, expiresAt: iso3m, activatedInstanceId: null, allowedHosts: ['cms.clean.example.test'] }),
            signToken({ billingModel: 'monthly_term', periodMonths: 3, exp: exp3m, expiresAt: iso3m, activatedInstanceId: null, allowedHosts: ['wrong.example.test'], stagingHosts: [] }),
            signToken({ billingModel: 'monthly_term', periodMonths: 3, exp: now - 30, iat: now - 3600, nbf: now - 3600, activatedInstanceId: null, allowedHosts: ['cms.clean.example.test'] }),
            signToken({ billingModel: 'monthly_term', periodMonths: 3, exp: exp3m, activatedInstanceId: null, allowedHosts: ['cms.clean.example.test'] }, { signingKey: wrongKeys.privateKey }),
          ]) {
            const badRes = await withOffer.call('/features/license', { method: 'POST', token: adminToken, body: { token: rejected } });
            assert.equal(badRes.status, 400);
            assert.equal(badRes.body.errors[0].code, 'INVALID_LICENSE');
          }

          // Activate valid Website 3-month monthly_term token
          const threeMonthToken = signToken({
            sub: 'lic-promo-3m',
            licenseId: 'lic-promo-3m',
            billingModel: 'monthly_term',
            periodMonths: 3,
            entitlementVersion: 1,
            iat: now,
            nbf: now - 1,
            exp: exp3m,
            expiresAt: iso3m,
            activatedInstanceId: null,
            allowedHosts: ['cms.clean.example.test'],
            stagingHosts: ['staging.clean.example.test'],
            capabilities: { contentHistory: true, whiteLabel: true },
          });
          const activateRes = await withOffer.call('/features/license', {
            method: 'POST',
            token: adminToken,
            body: { token: threeMonthToken },
          });
          assert.equal(activateRes.status, 200);
          assert.equal(activateRes.body.data.license.status, 'active');
          assert.equal(activateRes.body.data.license.billingModel, 'monthly_term');
          assert.equal(activateRes.body.data.license.periodMonths, 3);
          assert.equal(activateRes.body.data.license.expiresAt, iso3m);
          assert.equal(activateRes.body.data.features.contentHistory.enabled, true);
          assert.equal(activateRes.body.data.features.whiteLabel.allowed, true);
          assert.equal(Object.hasOwn(activateRes.body.data, 'premiumOffer'), false);

          // Simulate expiry of 3-month entitlement -> Premium closes, Community CRUD stays intact
          const expired3m = signToken({
            sub: 'lic-promo-3m', licenseId: 'lic-promo-3m', billingModel: 'monthly_term',
            periodMonths: 3, entitlementVersion: 1, iat: now - 7200, nbf: now - 7200, exp: now - 15,
            expiresAt: new Date((now - 15) * 1000).toISOString(),
            activatedInstanceId: null, allowedHosts: ['cms.clean.example.test'],
          });
          await database.query('UPDATE yuncms_license_state SET token = ? WHERE id = 1', [expired3m]);
          const expiredStatus = await withOffer.call('/features', { token: adminToken });
          assert.equal(expiredStatus.body.data.license.status, 'expired');
          assert.equal(expiredStatus.body.data.license.periodMonths, 3);
          assert.equal(expiredStatus.body.data.features.contentHistory.enabled, false);
          assert.equal((await withOffer.call(`/items/${collection}/${createdArticleId}`, { token: editorToken })).status, 200);
        } finally {
          await withOffer.close();
        }

        // 3) Real native CLI `runInitCommand` against disposable MySQL DB: skip & opt-in work cleanly with ZERO campaign tables & ZERO outbound calls
        const initDbName = 'yuncms_test_init_offer_' + randomBytes(5).toString('hex');
        const initDir = await mkdtemp(join(tmpdir(), 'yuncms-cli-init-offer-'));
        await rootPool.query('CREATE DATABASE `' + initDbName + '`');
        try {
          const skipLineAnswers = [
            baseConfig.database.host,
            String(baseConfig.database.port),
            initDbName,
            baseConfig.database.user,
            'false',
            'init-admin@demo.example',
            'n',
          ];
          const initPass = 'Disposable-Init-' + randomBytes(8).toString('hex') + '!';
          const skipSecretAnswers = [baseConfig.database.password, initPass, initPass];
          const skipLogs = [];
          const firstInit = await runInitCommand({
            cwd: initDir,
            env: { YUNCMS_PREMIUM_OFFER_URL: localOfferUrl },
            isTTY: true,
            output: { log(msg) { skipLogs.push(msg); } },
            prompts: {
              async line() { return skipLineAnswers.shift(); },
              async secret() { return skipSecretAnswers.shift(); },
            },
          });
          assert.equal(firstInit.existingAdmin, false);
          assert.deepEqual(firstInit.premiumOffer, { configured: true, optedIn: false, url: null });
          assert.equal(skipLogs.join('\n').includes(localOfferUrl), false);
          const envContent = await readFile(join(initDir, '.env'), 'utf8');
          assert.ok(envContent.includes(`YUNCMS_PREMIUM_OFFER_URL="${localOfferUrl}"`));

          // Second run (existing admin) with explicit opt-in ('y') shows exact URL without leaking admin email or calling Website
          const optLogs = [];
          const secondInit = await runInitCommand({
            cwd: initDir,
            env: {
              DB_HOST: baseConfig.database.host,
              DB_PORT: String(baseConfig.database.port),
              DB_DATABASE: initDbName,
              DB_USER: baseConfig.database.user,
              DB_PASSWORD: baseConfig.database.password,
              DB_SSL: 'false',
              YUNCMS_PREMIUM_OFFER_URL: localOfferUrl,
            },
            isTTY: true,
            output: { log(msg) { optLogs.push(msg); } },
            prompts: {
              async line() { return 'y'; },
              async secret() { throw new Error('unexpected secret prompt'); },
            },
          });
          assert.equal(secondInit.existingAdmin, true);
          assert.deepEqual(secondInit.premiumOffer, { configured: true, optedIn: true, url: localOfferUrl });
          assert.ok(optLogs.join('\n').includes(localOfferUrl));

          // Verify zero campaign tables exist in MySQL schema
          const [tables] = await rootPool.query('SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA = ?', [initDbName]);
          for (const row of tables) {
            assert.doesNotMatch(row.TABLE_NAME, /campaign|promo|newsletter/i);
          }
          assert.equal(offerHits.length, 0);
        } finally {
          await rootPool.query('DROP DATABASE IF EXISTS `' + initDbName + '`');
          await rm(initDir, { recursive: true, force: true });
        }
      } finally {
        await new Promise(resolve => offerServer.close(resolve));
      }
    });

    accepted = true;
  } finally {
    if (server) {
      const stopped = new Promise(resolve => server.close(resolve));
      server.closeAllConnections();
      await stopped;
    }
    await database.end();
    if (accepted || process.env.YUNCMS_TEST_PRESERVE_DB !== '1') {
      await rootPool.query('DROP DATABASE IF EXISTS `' + dbName + '`');
      await rm(storageDir, { recursive: true, force: true });
    }
    await rootPool.end();
  }
});
