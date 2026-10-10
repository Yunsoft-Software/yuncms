import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  bootstrapDatabase,
  closeDatabasePool,
  CollectionsService,
  createAccountability,
  createCoreServiceRegistry,
  createDatabasePool,
  createStorageRegistry,
  createSystemAccountability,
  ensurePublicRole,
  FieldsService,
  HookEmitter,
  ItemsService,
  loadConfig,
  LocalStorageDriver,
  PermissionsService,
  RolesService,
  SchemaCache,
  UsersService,
} from '@yunsoft/yuncms-core';
import { createApp } from '../../packages/api/src/app.js';

const ENABLED = process.env.YUNCMS_TEST_MYSQL === '1';
const DESTRUCTIVE = process.env.YUNCMS_TEST_DB_ALLOW_DESTRUCTIVE === '1';

function requireDisposableDatabase(config) {
  if (!DESTRUCTIVE) {
    throw new Error('YUNCMS_TEST_DB_ALLOW_DESTRUCTIVE=1 is required for integration suite');
  }
  const dbName = config.database?.database ?? '';
  if (!/(test|ci|dev)/i.test(dbName)) {
    throw new Error(`Integration DB name must contain test, ci or dev: ${dbName}`);
  }
}

function suffix() {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`.slice(-9);
}

test('singleton collection enforces create permission before occupancy checks or mutation locks over API and services', {
  skip: !ENABLED,
  timeout: 60_000,
}, async () => {
  const config = loadConfig(process.env);
  requireDisposableDatabase(config);
  const pool = createDatabasePool(config.database);

  const runId = suffix();
  const collection = `it_singleton_${runId}`;
  const storageRoot = await mkdtemp(join(tmpdir(), 'yuncms-singleton-auth-'));
  const schemaCache = new SchemaCache({ versionCheckTtlMs: 0 });
  const emitter = new HookEmitter();
  const system = createSystemAccountability();
  const options = {
    database: pool,
    accountability: system,
    schemaCache,
    emitter,
  };

  const collections = new CollectionsService(options);
  const fields = new FieldsService(options);
  const roles = new RolesService(options);
  const permissions = new PermissionsService(options);
  const users = new UsersService(options);

  let collectionCreated = false;
  let readOnlyRoleId = null;
  let readOnlyUserId = null;
  let creatorRoleId = null;
  let creatorUserId = null;
  let server = null;

  try {
    await bootstrapDatabase(pool);
    await ensurePublicRole(pool);

    await collections.createOne({
      collection,
      singleton: true,
      systemFields: ['created_at'],
    });
    collectionCreated = true;
    await fields.createOne(collection, { field: 'title', type: 'string' });

    // 1. Create a read-only role and user (read-only grant, no create permission)
    const readOnlyRole = await roles.createOne({ name: `read-only-${runId}` });
    readOnlyRoleId = readOnlyRole.id;
    await permissions.createOne({
      role: readOnlyRoleId,
      collection,
      action: 'read',
      fields: ['id', 'title'],
      filter: null,
    });

    const readerEmail = `reader-${runId}@example.com`;
    const readerPassword = `Reader-${runId}-Pass!`;
    const readerUser = await users.createOne({
      email: readerEmail,
      password: readerPassword,
      role: readOnlyRoleId,
      status: 'active',
      emailVerified: true,
    });
    readOnlyUserId = readerUser.id;

    // 2. Create an ordinary creator role and user with explicit native collection create/read grants (no admin role)
    const creatorRole = await roles.createOne({
      name: `creator-${runId}`,
    });
    creatorRoleId = creatorRole.id;
    await permissions.createOne({
      role: creatorRoleId,
      collection,
      action: 'read',
      fields: ['id', 'title'],
      filter: null,
    });
    await permissions.createOne({
      role: creatorRoleId,
      collection,
      action: 'create',
      fields: ['id', 'title'],
      filter: null,
    });

    const creatorEmail = `creator-${runId}@example.com`;
    const creatorPassword = `Creator-${runId}-Pass!`;
    const creatorUser = await users.createOne({
      email: creatorEmail,
      password: creatorPassword,
      role: creatorRoleId,
      status: 'active',
      emailVerified: true,
    });
    creatorUserId = creatorUser.id;

    const restrictedService = new ItemsService(collection, {
      ...options,
      accountability: createAccountability({ user: readOnlyUserId, role: readOnlyRoleId }),
    });

    const creatorService = new ItemsService(collection, {
      ...options,
      accountability: createAccountability({ user: creatorUserId, role: creatorRoleId }),
    });

    // 3. Start real loopback HTTP server
    const storage = createStorageRegistry({
      local: new LocalStorageDriver({ root: storageRoot }),
    });
    const app = createApp({
      pool,
      config,
      serviceRegistry: createCoreServiceRegistry(),
      schemaCache,
      emitter,
      storage,
      logger: { info() {}, warn() {}, error() {} },
    });

    server = await new Promise((resolve, reject) => {
      const instance = app.listen(0, '127.0.0.1', () => resolve(instance));
      instance.once('error', reject);
    });
    const origin = `http://127.0.0.1:${server.address().port}`;

    async function apiRequest(path, { token = null, body, ...rest } = {}) {
      const headers = new Headers();
      if (token) headers.set('authorization', `Bearer ${token}`);
      if (body !== undefined) headers.set('content-type', 'application/json');
      const response = await fetch(`${origin}${path}`, {
        ...rest,
        headers,
        body: body !== undefined ? JSON.stringify(body) : undefined,
      });
      const payload = await response.json().catch(() => null);
      return { status: response.status, payload };
    }

    // Authenticate both users via HTTP
    const readerLogin = await apiRequest('/auth/login', {
      method: 'POST',
      body: { email: readerEmail, password: readerPassword },
    });
    assert.equal(readerLogin.status, 200);
    const readerToken = readerLogin.payload?.data?.access_token;
    assert.ok(readerToken);

    const creatorLogin = await apiRequest('/auth/login', {
      method: 'POST',
      body: { email: creatorEmail, password: creatorPassword },
    });
    assert.equal(creatorLogin.status, 200);
    const creatorToken = creatorLogin.payload?.data?.access_token;
    assert.ok(creatorToken);

    // 4. Empty singleton: unauthorized service and HTTP calls must receive 403 FORBIDDEN
    await assert.rejects(
      () => restrictedService.createOne({ title: 'Unauthorized' }),
      (err) => err.code === 'FORBIDDEN',
    );
    await assert.rejects(
      () => restrictedService.createMany([]),
      (err) => err.code === 'FORBIDDEN',
    );
    await assert.rejects(
      () => restrictedService.createMany([{ title: 'Unauthorized 1' }, { title: 'Unauthorized 2' }]),
      (err) => err.code === 'FORBIDDEN',
    );
    await assert.rejects(
      () => restrictedService.createMany([{ title: 'Unauthorized' }]),
      (err) => err.code === 'FORBIDDEN',
    );

    const emptyPost = await apiRequest(`/items/${collection}`, {
      method: 'POST',
      token: readerToken,
      body: { title: 'Unauthorized on empty' },
    });
    assert.equal(emptyPost.status, 403);
    assert.equal(emptyPost.payload?.errors?.[0]?.code, 'FORBIDDEN');

    // 5. Authorized HTTP POST: occupies the singleton => 200/201 success
    const authorizedPost = await apiRequest(`/items/${collection}`, {
      method: 'POST',
      token: creatorToken,
      body: { title: 'Authorized Initial' },
    });
    assert.ok(authorizedPost.status === 200 || authorizedPost.status === 201);
    assert.equal(authorizedPost.payload?.data?.title, 'Authorized Initial');

    // 6. Occupied singleton: unauthorized HTTP POST and service calls must still receive 403 FORBIDDEN (not 409!)
    const occupiedUnauthorizedPost = await apiRequest(`/items/${collection}`, {
      method: 'POST',
      token: readerToken,
      body: { title: 'Unauthorized on occupied' },
    });
    assert.equal(occupiedUnauthorizedPost.status, 403);
    assert.equal(occupiedUnauthorizedPost.payload?.errors?.[0]?.code, 'FORBIDDEN');

    await assert.rejects(
      () => restrictedService.createOne({ title: 'Unauthorized on occupied' }),
      (err) => err.code === 'FORBIDDEN',
    );
    await assert.rejects(
      () => restrictedService.createMany([{ title: 'Unauthorized on occupied' }]),
      (err) => err.code === 'FORBIDDEN',
    );

    // 7. Occupied singleton: authorized caller collides => 409 SINGLETON_ITEM_EXISTS over HTTP and services
    const authorizedCollisionPost = await apiRequest(`/items/${collection}`, {
      method: 'POST',
      token: creatorToken,
      body: { title: 'Authorized Collision' },
    });
    assert.equal(authorizedCollisionPost.status, 409);
    assert.equal(authorizedCollisionPost.payload?.errors?.[0]?.code, 'SINGLETON_ITEM_EXISTS');

    await assert.rejects(
      () => creatorService.createOne({ title: 'Authorized Collision' }),
      (err) => err.code === 'SINGLETON_ITEM_EXISTS',
    );
    await assert.rejects(
      () => creatorService.createMany([{ title: 'Authorized Collision' }]),
      (err) => err.code === 'SINGLETON_ITEM_EXISTS',
    );
  } finally {
    const cleanupErrors = [];
    if (server) {
      try {
        await new Promise((resolve) => server.close(resolve));
      } catch (err) {
        cleanupErrors.push(err);
      }
    }
    if (collectionCreated) {
      try {
        await collections.deleteOne(collection, { destructive: true });
      } catch (err) {
        cleanupErrors.push(err);
      }
    }
    for (const userId of [readOnlyUserId, creatorUserId].filter(Boolean)) {
      try {
        await users.deleteOne(userId);
      } catch (err) {
        cleanupErrors.push(err);
      }
    }
    for (const roleId of [readOnlyRoleId, creatorRoleId].filter(Boolean)) {
      try {
        await roles.deleteOne(roleId);
      } catch (err) {
        cleanupErrors.push(err);
      }
    }
    try {
      await rm(storageRoot, { recursive: true, force: true });
    } catch (err) {
      cleanupErrors.push(err);
    }
    try {
      await closeDatabasePool(pool);
    } catch (err) {
      cleanupErrors.push(err);
    }
    if (cleanupErrors.length > 0) {
      throw new Error(`Integration cleanup failed with ${cleanupErrors.length} error(s): ${cleanupErrors.map((e) => e.message).join('; ')}`);
    }
  }
});
