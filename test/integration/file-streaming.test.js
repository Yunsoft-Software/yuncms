import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  ApiTokensService,
  bootstrapDatabase,
  closeDatabasePool,
  createCoreServiceRegistry,
  createDatabasePool,
  createStorageRegistry,
  createSystemAccountability,
  FilesService,
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

function suffix() {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`.slice(-10);
}

function requireDisposableDatabase(config) {
  if (!DESTRUCTIVE) {
    throw new Error('YUNCMS_TEST_DB_ALLOW_DESTRUCTIVE=1 is required for the integration suite');
  }
  if (!/(test|ci|dev)/i.test(config.database.database)) {
    throw new Error(`Integration DB name must contain test, ci or dev: ${config.database.database}`);
  }
}

test('guarded real MySQL/API streaming covers private file, two roles, range requests, metadata HEAD, and multi-MB file', {
  skip: !ENABLED,
  timeout: 60_000,
}, async () => {
  const config = loadConfig(process.env);
  requireDisposableDatabase(config);
  const pool = createDatabasePool(config.database);

  const runId = suffix();
  const system = createSystemAccountability();
  const schemaCache = new SchemaCache();

  // Temporary storage directory
  const storageRoot = await mkdtemp(join(tmpdir(), `yuncms-stream-it-${runId}-`));
  const localStorageDriver = new LocalStorageDriver({ root: storageRoot });

  // Instrument driver to verify HEAD doesn't call getStream
  let driverGetStreamCalled = false;
  const originalGetStream = localStorageDriver.getStream.bind(localStorageDriver);
  localStorageDriver.getStream = async (...args) => {
    driverGetStreamCalled = true;
    return originalGetStream(...args);
  };

  const storage = createStorageRegistry({ local: localStorageDriver });

  const rolesService = new RolesService({ accountability: system, database: pool });
  const permissionsService = new PermissionsService({ accountability: system, database: pool });
  const usersService = new UsersService({ accountability: system, database: pool });
  const apiTokensService = new ApiTokensService({ accountability: system, database: pool });
  const filesService = new FilesService({ accountability: system, database: pool, storage });

  const createdRoles = [];
  const createdPermissions = [];
  const createdUsers = [];
  const createdTokens = [];
  const createdFiles = [];

  let fullRoleId = null;
  let restrictedRoleId = null;
  let fullUserId = null;
  let restrictedUserId = null;
  let privateFileId = null;
  let publicFileId = null;
  let server = null;

  try {
    await bootstrapDatabase(pool);

    // 1. Create two roles
    const fullRole = await rolesService.createOne({
      name: `Full Files Role ${runId}`,
      admin: false,
    });
    fullRoleId = fullRole.id;
    createdRoles.push(fullRoleId);

    const restrictedRole = await rolesService.createOne({
      name: `Restricted Files Role ${runId}`,
      admin: false,
    });
    restrictedRoleId = restrictedRole.id;
    createdRoles.push(restrictedRoleId);

    // 2. Grant permissions
    // Full role: read access to all yuncms_files
    const perm1 = await permissionsService.createOne({
      role: fullRoleId,
      collection: 'yuncms_files',
      action: 'read',
    });
    createdPermissions.push(perm1.id);

    // Restricted role: read access only to files where title = 'public-asset'
    const perm2 = await permissionsService.createOne({
      role: restrictedRoleId,
      collection: 'yuncms_files',
      action: 'read',
      filter: { title: { _eq: 'public-asset' } },
    });
    createdPermissions.push(perm2.id);

    // 3. Create users and API tokens for both roles
    const fullUser = await usersService.createOne({
      email: `full-${runId}@example.invalid`,
      password: `Full-${runId}-Pass!`,
      role: fullRoleId,
      status: 'active',
      emailVerified: true,
    });
    fullUserId = fullUser.id;
    createdUsers.push(fullUserId);

    const fullTokenResult = await apiTokensService.createOne({
      user: fullUserId,
      name: `Full Token ${runId}`,
    });
    createdTokens.push({ id: fullTokenResult.id, user: fullUserId });
    const fullToken = fullTokenResult.token;

    const restrictedUser = await usersService.createOne({
      email: `restricted-${runId}@example.invalid`,
      password: `Restricted-${runId}-Pass!`,
      role: restrictedRoleId,
      status: 'active',
      emailVerified: true,
    });
    restrictedUserId = restrictedUser.id;
    createdUsers.push(restrictedUserId);

    const restrictedTokenResult = await apiTokensService.createOne({
      user: restrictedUserId,
      name: `Restricted Token ${runId}`,
    });
    createdTokens.push({ id: restrictedTokenResult.id, user: restrictedUserId });
    const restrictedToken = restrictedTokenResult.token;

    // 4. Create synthetic multi-MB private file (2 MiB)
    const twoMegabytes = 2 * 1024 * 1024;
    const privateBuffer = Buffer.alloc(twoMegabytes);
    for (let i = 0; i < twoMegabytes; i++) {
      privateBuffer[i] = i % 256;
    }
    const privateFile = await filesService.createOne({
      contents: privateBuffer,
      filenameDownload: 'private-data.bin',
      title: 'private-file',
      mimetype: 'application/octet-stream',
      storage: 'local',
    });
    privateFileId = privateFile.id;
    createdFiles.push(privateFileId);

    // 5. Create public file (64 KiB)
    const publicBuffer = Buffer.from('Public Asset Content'.repeat(3000));
    const publicFile = await filesService.createOne({
      contents: publicBuffer,
      filenameDownload: 'public-asset.txt',
      title: 'public-asset',
      mimetype: 'text/plain',
      storage: 'local',
    });
    publicFileId = publicFile.id;
    createdFiles.push(publicFileId);

    // 6. Start API server
    const app = createApp({
      pool,
      config: {
        ...config,
        server: { ...config.server, studioOrigin: 'http://localhost:3008', trustProxyHops: 0 },
        storage: { ...config.storage, maxUploadBytes: 25 * 1024 * 1024 },
        auth: { ...config.auth, rateLimit: {} },
      },
      storage,
      schemaCache,
    });

    server = await new Promise((resolve, reject) => {
      const instance = app.listen(0, '127.0.0.1', () => resolve(instance));
      instance.once('error', reject);
    });
    const { port } = server.address();
    const origin = `http://127.0.0.1:${port}`;

    // Test A: Restricted role cannot access private file (returns 404 via read filter)
    const deniedRes = await fetch(`${origin}/files/${privateFileId}/content`, {
      headers: { Authorization: `Bearer ${restrictedToken}` },
    });
    assert.equal(deniedRes.status, 404);
    await deniedRes.text();

    // Test B: Restricted role can access permitted public file
    const allowedRes = await fetch(`${origin}/files/${publicFileId}/content`, {
      headers: { Authorization: `Bearer ${restrictedToken}` },
    });
    assert.equal(allowedRes.status, 200);
    assert.equal(allowedRes.headers.get('accept-ranges'), 'bytes');
    const allowedBytes = Buffer.from(await allowedRes.arrayBuffer());
    assert.deepEqual(allowedBytes, publicBuffer);

    // Test C: Granted role accessing full 2 MiB private file
    const fullRes = await fetch(`${origin}/files/${privateFileId}/content`, {
      headers: { Authorization: `Bearer ${fullToken}` },
    });
    assert.equal(fullRes.status, 200);
    assert.equal(fullRes.headers.get('accept-ranges'), 'bytes');
    assert.equal(fullRes.headers.get('content-length'), String(twoMegabytes));
    const fullReceived = Buffer.from(await fullRes.arrayBuffer());
    assert.deepEqual(fullReceived, privateBuffer);

    // Test D: Single valid range 0-1023 (first 1 KiB)
    const range1Res = await fetch(`${origin}/files/${privateFileId}/content`, {
      headers: {
        Authorization: `Bearer ${fullToken}`,
        Range: 'bytes=0-1023',
      },
    });
    assert.equal(range1Res.status, 206);
    assert.equal(range1Res.headers.get('accept-ranges'), 'bytes');
    assert.equal(range1Res.headers.get('content-range'), `bytes 0-1023/${twoMegabytes}`);
    assert.equal(range1Res.headers.get('content-length'), '1024');
    const range1Bytes = Buffer.from(await range1Res.arrayBuffer());
    assert.deepEqual(range1Bytes, privateBuffer.subarray(0, 1024));

    // Test E: Middle range 1048576-1049599 (1 KiB from 1 MiB offset)
    const range2Res = await fetch(`${origin}/files/${privateFileId}/content`, {
      headers: {
        Authorization: `Bearer ${fullToken}`,
        Range: 'bytes=1048576-1049599',
      },
    });
    assert.equal(range2Res.status, 206);
    assert.equal(range2Res.headers.get('content-range'), `bytes 1048576-1049599/${twoMegabytes}`);
    assert.equal(range2Res.headers.get('content-length'), '1024');
    const range2Bytes = Buffer.from(await range2Res.arrayBuffer());
    assert.deepEqual(range2Bytes, privateBuffer.subarray(1048576, 1049600));

    // Test F: Suffix range -512 (last 512 bytes)
    const suffixRes = await fetch(`${origin}/files/${privateFileId}/content`, {
      headers: {
        Authorization: `Bearer ${fullToken}`,
        Range: 'bytes=-512',
      },
    });
    assert.equal(suffixRes.status, 206);
    assert.equal(suffixRes.headers.get('content-range'), `bytes ${twoMegabytes - 512}-${twoMegabytes - 1}/${twoMegabytes}`);
    assert.equal(suffixRes.headers.get('content-length'), '512');
    const suffixBytes = Buffer.from(await suffixRes.arrayBuffer());
    assert.deepEqual(suffixBytes, privateBuffer.subarray(twoMegabytes - 512));

    // Test G: Unsatisfiable range (416)
    const unsatisfiableRes = await fetch(`${origin}/files/${privateFileId}/content`, {
      headers: {
        Authorization: `Bearer ${fullToken}`,
        Range: `bytes=${twoMegabytes + 1000}-${twoMegabytes + 2000}`,
      },
    });
    assert.equal(unsatisfiableRes.status, 416);
    assert.equal(unsatisfiableRes.headers.get('accept-ranges'), 'bytes');
    assert.equal(unsatisfiableRes.headers.get('content-range'), `bytes */${twoMegabytes}`);
    assert.equal(unsatisfiableRes.headers.get('content-length'), '0');
    assert.equal(await unsatisfiableRes.text(), '');

    // Test H: Metadata-only HEAD ignores Range and does not open body
    driverGetStreamCalled = false;
    const headRes = await fetch(`${origin}/files/${privateFileId}/content`, {
      method: 'HEAD',
      headers: {
        Authorization: `Bearer ${fullToken}`,
        Range: 'bytes=0-1023',
      },
    });
    assert.equal(headRes.status, 200);
    assert.equal(headRes.headers.get('accept-ranges'), 'bytes');
    assert.equal(headRes.headers.get('content-length'), String(twoMegabytes));
    assert.ok(headRes.headers.get('etag'));
    assert.equal(driverGetStreamCalled, false); // Crucial: getStream was never called!
    assert.equal(await headRes.text(), '');

    // Test I: If-Range with strong ETag match vs weak ETag
    const etag = headRes.headers.get('etag');
    const ifRangeMatchRes = await fetch(`${origin}/files/${privateFileId}/content`, {
      headers: {
        Authorization: `Bearer ${fullToken}`,
        Range: 'bytes=0-1023',
        'If-Range': etag,
      },
    });
    assert.equal(ifRangeMatchRes.status, 206);
    const ifRangeMatchBytes = Buffer.from(await ifRangeMatchRes.arrayBuffer());
    assert.deepEqual(ifRangeMatchBytes, privateBuffer.subarray(0, 1024));

    const ifRangeWeakRes = await fetch(`${origin}/files/${privateFileId}/content`, {
      headers: {
        Authorization: `Bearer ${fullToken}`,
        Range: 'bytes=0-1023',
        'If-Range': `W/${etag}`,
      },
    });
    assert.equal(ifRangeWeakRes.status, 200);
    const ifRangeWeakBytes = Buffer.from(await ifRangeWeakRes.arrayBuffer());
    assert.deepEqual(ifRangeWeakBytes, privateBuffer);
  } finally {
    const cleanupErrors = [];

    if (server) {
      try {
        if (typeof server.closeAllConnections === 'function') {
          server.closeAllConnections();
        }
        await new Promise((resolve) => server.close(resolve));
      } catch (err) {
        cleanupErrors.push(new Error(`Failed to close server: ${err.message}`));
      }
    }

    // Cleanup files via filesService.deleteOne
    for (const fileId of createdFiles) {
      try {
        await filesService.deleteOne(fileId);
      } catch (err) {
        cleanupErrors.push(new Error(`Failed to clean up file ${fileId}: ${err.message}`));
      }
    }

    // Cleanup tokens via apiTokensService.deleteOne
    for (const token of createdTokens) {
      try {
        await apiTokensService.deleteOne(token.id, token.user);
      } catch (err) {
        cleanupErrors.push(new Error(`Failed to clean up token ${token.id}: ${err.message}`));
      }
    }

    // Cleanup users via usersService.deleteOne
    for (const userId of createdUsers) {
      try {
        await usersService.deleteOne(userId);
      } catch (err) {
        cleanupErrors.push(new Error(`Failed to clean up user ${userId}: ${err.message}`));
      }
    }

    // Cleanup permissions via permissionsService.deleteOne
    for (const permId of createdPermissions) {
      try {
        await permissionsService.deleteOne(permId);
      } catch (err) {
        cleanupErrors.push(new Error(`Failed to clean up permission ${permId}: ${err.message}`));
      }
    }

    // Cleanup roles via rolesService.deleteOne
    for (const roleId of createdRoles) {
      try {
        await rolesService.deleteOne(roleId);
      } catch (err) {
        cleanupErrors.push(new Error(`Failed to clean up role ${roleId}: ${err.message}`));
      }
    }

    // Cleanup storage root directory
    try {
      await rm(storageRoot, { recursive: true, force: true });
    } catch (err) {
      cleanupErrors.push(new Error(`Failed to clean up storage root ${storageRoot}: ${err.message}`));
    }

    // Close database pool
    try {
      await closeDatabasePool(pool);
    } catch (err) {
      cleanupErrors.push(new Error(`Failed to close database pool: ${err.message}`));
    }

    if (cleanupErrors.length > 0) {
      throw new Error(`Integration test cleanup encountered errors:\n${cleanupErrors.map((e) => e.message || String(e)).join('\n')}`);
    }
  }
});
