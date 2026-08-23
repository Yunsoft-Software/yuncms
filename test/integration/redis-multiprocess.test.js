import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer as createNetServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import {
  ApiTokensService,
  bootstrapDatabase,
  closeDatabasePool,
  CollectionsService,
  createDatabasePool,
  createSystemAccountability,
  ensurePublicRole,
  FieldsService,
  ItemsService,
  loadConfig,
  RedisClient,
  RolesService,
  SchemaCache,
  UsersService,
} from '@yunsoft/yuncms-core';

const ENABLED = process.env.YUNCMS_TEST_MYSQL === '1'
  && process.env.YUNCMS_TEST_REDIS === '1';
const DESTRUCTIVE = process.env.YUNCMS_TEST_DB_ALLOW_DESTRUCTIVE === '1';
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const SERVER_ENTRY = join(ROOT, 'packages/api/src/server.js');

function suffix() {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`.slice(-12);
}

function requireDisposableDatabase(config) {
  if (!DESTRUCTIVE) throw new Error('YUNCMS_TEST_DB_ALLOW_DESTRUCTIVE=1 is required');
  if (!/(test|ci|dev)/i.test(config.database.database)) {
    throw new Error(`Integration DB name must contain test, ci or dev: ${config.database.database}`);
  }
  if (!process.env.YUNCMS_TEST_REDIS_URL) {
    throw new Error('YUNCMS_TEST_REDIS_URL is required when YUNCMS_TEST_REDIS=1');
  }
}

function availablePort() {
  return new Promise((resolvePort, reject) => {
    const reservation = createNetServer();
    reservation.listen(0, '127.0.0.1', () => {
      const port = reservation.address().port;
      reservation.close((error) => (error ? reject(error) : resolvePort(port)));
    });
    reservation.once('error', reject);
  });
}

function wait(ms) {
  return new Promise((resolveWait) => setTimeout(resolveWait, ms));
}

function waitUnref(ms) {
  return new Promise((resolveWait) => setTimeout(resolveWait, ms).unref());
}

function startApi(port, env) {
  const child = spawn(process.execPath, [SERVER_ENTRY], {
    cwd: ROOT,
    env: { ...process.env, ...env, PORT: String(port), HOST: '127.0.0.1' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const output = [];
  const capture = (chunk) => {
    output.push(chunk.toString('utf8'));
    if (output.length > 200) output.shift();
  };
  child.stdout.on('data', capture);
  child.stderr.on('data', capture);
  const exited = new Promise((resolveExit) => {
    child.once('exit', (code, signal) => resolveExit({ code, signal }));
  });
  return { child, exited, output, port };
}

async function waitForReady(processInfo, timeoutMs = 20_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (processInfo.child.exitCode != null) {
      throw new Error(`API process exited before readiness:\n${processInfo.output.join('')}`);
    }
    try {
      const response = await fetch(`http://127.0.0.1:${processInfo.port}/ready`);
      if (response.status === 200) return;
    } catch {}
    await wait(100);
  }
  throw new Error(`API process did not become ready:\n${processInfo.output.join('')}`);
}

async function stopApi(processInfo) {
  if (!processInfo || processInfo.child.exitCode != null) return;
  processInfo.child.kill('SIGTERM');
  const result = await Promise.race([
    processInfo.exited,
    waitUnref(12_000).then(() => null),
  ]);
  if (!result) {
    processInfo.child.kill('SIGKILL');
    await processInfo.exited;
    throw new Error(`API process exceeded shutdown budget:\n${processInfo.output.join('')}`);
  }
  assert.equal(result.code, 0, `API process shutdown failed:\n${processInfo.output.join('')}`);
}

async function responseBody(response) {
  if (response.status === 204) return null;
  const type = response.headers.get('content-type') ?? '';
  if (type.includes('application/json')) return response.json();
  return response.arrayBuffer();
}

test('two API processes share Redis permission invalidation and rate-limit state', {
  skip: !ENABLED,
  timeout: 120_000,
}, async () => {
  const config = loadConfig(process.env);
  requireDisposableDatabase(config);
  const pool = createDatabasePool(config.database);
  const system = createSystemAccountability();
  const runId = suffix();
  const collection = `it_redis_${runId}`;
  const prefix = `yuncms:integration:${runId}:`;
  const storageRoot = await mkdtemp(join(tmpdir(), 'yuncms-redis-process-'));
  const redis = new RedisClient({ url: process.env.YUNCMS_TEST_REDIS_URL });
  const processes = [];
  const cleanup = { collectionCreated: false, tokenIds: [], userIds: [], roleIds: [], fileIds: [] };

  try {
    await bootstrapDatabase(pool);
    await redis.connect();
    assert.equal(await redis.ping(), true);

    const publicRole = await ensurePublicRole(pool);
    const roles = new RolesService({ accountability: system, database: pool });
    const adminRole = await roles.createOne({ name: `Redis Admin ${runId}`, admin: true });
    const memberRole = await roles.createOne({ name: `Redis Reader ${runId}` });
    cleanup.roleIds.push(memberRole.id, adminRole.id);

    const adminEmail = `redis-admin-${runId}@example.test`;
    const memberEmail = `redis-reader-${runId}@example.test`;
    const users = new UsersService({ accountability: system, database: pool });
    const adminUser = await users.createOne({
      email: adminEmail,
      password: `Redis-Admin-${runId}!`,
      role: adminRole.id,
      status: 'active',
      emailVerified: true,
    });
    const memberUser = await users.createOne({
      email: memberEmail,
      password: `Redis-Member-${runId}!`,
      role: memberRole.id,
      status: 'active',
      emailVerified: true,
    });
    cleanup.userIds.push(memberUser.id, adminUser.id);

    const tokens = new ApiTokensService({ accountability: system, database: pool });
    const adminToken = await tokens.createOne({ user: adminUser.id, name: `admin-${runId}` });
    const memberToken = await tokens.createOne({ user: memberUser.id, name: `member-${runId}` });
    cleanup.tokenIds.push(memberToken.id, adminToken.id);

    const collections = new CollectionsService({ accountability: system, database: pool });
    await collections.createOne({ collection });
    cleanup.collectionCreated = true;
    await new FieldsService({ accountability: system, database: pool }).createOne(collection, {
      field: 'title',
      type: 'string',
      required: true,
    });
    await new ItemsService(collection, {
      accountability: system,
      database: pool,
      schemaCache: new SchemaCache({ versionCheckTtlMs: 0 }),
    }).createOne({ title: 'Redis-visible' });

    const [portA, portB] = await Promise.all([availablePort(), availablePort()]);
    const sharedEnv = {
      DB_HOST: config.database.host,
      DB_PORT: String(config.database.port),
      DB_DATABASE: config.database.database,
      DB_USER: config.database.user,
      DB_PASSWORD: config.database.password,
      DB_SSL: config.database.ssl ? 'true' : 'false',
      FILES_LOCAL_ROOT: storageRoot,
      CACHE_STORE: 'redis',
      CACHE_ENABLED: 'true',
      CACHE_TTL_MS: '60000',
      API_RATE_LIMIT_STORE: 'redis',
      API_RATE_LIMIT_ENABLED: 'true',
      API_RATE_LIMIT_WINDOW_MS: '60000',
      API_RATE_LIMIT_MAX: '5',
      AUTH_RATE_LIMIT_STORE: 'redis',
      AUTH_LOGIN_RATE_WINDOW_MS: '60000',
      AUTH_LOGIN_RATE_MAX: '2',
      REDIS_URL: process.env.YUNCMS_TEST_REDIS_URL,
      REDIS_PREFIX: prefix,
      REDIS_REQUIRED: 'true',
      RATE_LIMIT_FAILURE_MODE: 'required',
      TRUST_PROXY_HOPS: '1',
      PRESSURE_LIMIT_ENABLED: 'false',
      MCP_ENABLED: 'false',
      LOG_LEVEL: 'warn',
    };
    const processA = startApi(portA, { ...sharedEnv, STUDIO_ORIGIN: `http://127.0.0.1:${portA}` });
    const processB = startApi(portB, { ...sharedEnv, STUDIO_ORIGIN: `http://127.0.0.1:${portB}` });
    processes.push(processA, processB);
    await Promise.all([waitForReady(processA), waitForReady(processB)]);

    let setupRequest = 0;
    async function request(processInfo, path, {
      token = null,
      body,
      headers = {},
      ip = null,
      ...options
    } = {}) {
      const finalHeaders = new Headers(headers);
      finalHeaders.set('x-forwarded-for', ip ?? `198.51.100.${10 + setupRequest++}`);
      if (token) finalHeaders.set('authorization', `Bearer ${token}`);
      const isBytes = body instanceof Uint8Array;
      if (body !== undefined && !isBytes && !finalHeaders.has('content-type')) {
        finalHeaders.set('content-type', 'application/json');
      }
      const response = await fetch(`http://127.0.0.1:${processInfo.port}${path}`, {
        ...options,
        headers: finalHeaders,
        body: body === undefined ? undefined : isBytes ? body : JSON.stringify(body),
      });
      return { response, payload: await responseBody(response) };
    }

    const memberDenied = await request(processB, `/items/${collection}`, { token: memberToken.token });
    assert.equal(memberDenied.response.status, 403);

    const contentPermission = await request(processA, '/permissions', {
      method: 'POST',
      token: adminToken.token,
      body: { role: memberRole.id, collection, action: 'read', fields: ['id', 'title'] },
    });
    assert.equal(contentPermission.response.status, 201);
    const memberAllowed = await request(processB, `/items/${collection}`, { token: memberToken.token });
    assert.equal(memberAllowed.response.status, 200);
    assert.deepEqual(memberAllowed.payload.data.map((item) => item.title), ['Redis-visible']);

    const contentPermissionDeleted = await request(processA, `/permissions/${contentPermission.payload.data.id}`, {
      method: 'DELETE', token: adminToken.token,
    });
    assert.equal(contentPermissionDeleted.response.status, 204);
    const memberDeniedAfterInvalidation = await request(processB, `/items/${collection}`, { token: memberToken.token });
    assert.equal(memberDeniedAfterInvalidation.response.status, 403);

    async function upload(title, text) {
      const uploaded = await request(processA, '/files', {
        method: 'POST',
        token: adminToken.token,
        headers: {
          'content-type': 'application/octet-stream',
          'x-filename': encodeURIComponent(`${title}-${runId}.txt`),
          'x-title': title,
          'x-mimetype': 'text/plain',
        },
        body: new TextEncoder().encode(text),
      });
      assert.equal(uploaded.response.status, 201);
      cleanup.fileIds.push(uploaded.payload.data.id);
      return uploaded.payload.data;
    }
    const visibleFile = await upload('Public visible', `visible-${runId}`);
    const hiddenFile = await upload('Public hidden', `hidden-${runId}`);

    const publicDenied = await request(processB, '/files');
    assert.equal(publicDenied.response.status, 403);
    const publicPermission = await request(processA, '/permissions', {
      method: 'POST',
      token: adminToken.token,
      body: {
        role: publicRole.id,
        collection: 'yuncms_files',
        action: 'read',
        filter: { title: { _eq: 'Public visible' } },
      },
    });
    assert.equal(publicPermission.response.status, 201);

    const filteredFiles = await request(processB, '/files');
    assert.equal(filteredFiles.response.status, 200);
    assert.deepEqual(filteredFiles.payload.data.map((file) => file.id), [visibleFile.id]);
    assert.equal((await request(processB, `/files/${visibleFile.id}`)).response.status, 200);
    assert.equal((await request(processB, `/files/${visibleFile.id}/content`)).response.status, 200);
    assert.equal((await request(processB, `/files/${hiddenFile.id}`)).response.status, 404);
    assert.equal((await request(processB, `/files/${hiddenFile.id}/content`)).response.status, 404);

    const unfilteredPermission = await request(processA, `/permissions/${publicPermission.payload.data.id}`, {
      method: 'PATCH', token: adminToken.token, body: { filter: null },
    });
    assert.equal(unfilteredPermission.response.status, 200);
    const unfilteredFiles = await request(processB, '/files');
    assert.equal(unfilteredFiles.response.status, 200);
    assert.deepEqual(new Set(unfilteredFiles.payload.data.map((file) => file.id)), new Set([visibleFile.id, hiddenFile.id]));
    assert.equal((await request(processB, `/files/${hiddenFile.id}/content`)).response.status, 200);

    const publicPermissionDeleted = await request(processA, `/permissions/${publicPermission.payload.data.id}`, {
      method: 'DELETE', token: adminToken.token,
    });
    assert.equal(publicPermissionDeleted.response.status, 204);
    assert.equal((await request(processB, '/files')).response.status, 403);
    assert.equal((await request(processB, `/files/${visibleFile.id}`)).response.status, 403);
    assert.equal((await request(processB, `/files/${visibleFile.id}/content`)).response.status, 403);

    const apiIp = '203.0.113.41';
    for (let index = 0; index < 5; index += 1) {
      const target = index % 2 === 0 ? processA : processB;
      const response = await request(target, '/auth/providers', { ip: apiIp });
      assert.equal(response.response.status, 200);
      assert.equal(response.response.headers.get('x-ratelimit-remaining'), String(4 - index));
    }
    const apiLimited = await request(processB, '/auth/providers', { ip: apiIp });
    assert.equal(apiLimited.response.status, 429);
    assert.equal(apiLimited.payload.errors[0].code, 'RATE_LIMITED');

    const authIp = '203.0.113.42';
    for (const target of [processA, processB]) {
      const invalidLogin = await request(target, '/auth/login', {
        method: 'POST', ip: authIp, body: { email: memberEmail, password: 'definitely-wrong' },
      });
      assert.equal(invalidLogin.response.status, 401);
    }
    const authLimited = await request(processA, '/auth/login', {
      method: 'POST', ip: authIp, body: { email: memberEmail, password: 'definitely-wrong' },
    });
    assert.equal(authLimited.response.status, 429);
    assert.equal(authLimited.payload.errors[0].code, 'RATE_LIMITED');

    const redisKeys = await redis.command('KEYS', `${prefix}*`);
    assert.ok(redisKeys.some((key) => key === `${prefix}permission:generation`));
    assert.ok(redisKeys.some((key) => key.includes('rate:api:')));
    assert.ok(redisKeys.some((key) => key.includes('rate:auth:login:')));
    const joinedKeys = redisKeys.join('\n');
    assert.equal(joinedKeys.includes(memberEmail), false);
    assert.equal(joinedKeys.includes(adminToken.token), false);
    assert.equal(joinedKeys.includes(memberToken.token), false);

    for (const fileId of cleanup.fileIds.splice(0)) {
      const deleted = await request(processA, `/files/${fileId}`, { method: 'DELETE', token: adminToken.token });
      assert.equal(deleted.response.status, 204);
    }
  } finally {
    let cleanupError = null;
    for (const processInfo of processes.reverse()) {
      try { await stopApi(processInfo); } catch (error) { cleanupError ??= error; }
    }
    try {
      const keys = await redis.command('KEYS', `${prefix}*`);
      if (keys.length) await redis.command('DEL', ...keys);
    } catch {}
    await redis.close().catch(() => {});
    try {
      if (cleanup.collectionCreated) {
        await new CollectionsService({ accountability: system, database: pool }).deleteOne(collection, { destructive: true });
      }
      if (cleanup.userIds.length) {
        await pool.query(`DELETE FROM yuncms_users WHERE id IN (${cleanup.userIds.map(() => '?').join(', ')})`, cleanup.userIds);
      }
      if (cleanup.roleIds.length) {
        await pool.query(`DELETE FROM yuncms_roles WHERE id IN (${cleanup.roleIds.map(() => '?').join(', ')})`, cleanup.roleIds);
      }
    } catch (error) {
      cleanupError ??= error;
    }
    await closeDatabasePool(pool).catch(() => {});
    await rm(storageRoot, { recursive: true, force: true });
    if (cleanupError) throw cleanupError;
  }
});
