import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  bootstrapDatabase,
  createCoreServiceRegistry,
  createDatabasePool,
  createStorageRegistry,
  createSystemAccountability,
  ensurePublicRole,
  HookEmitter,
  loadConfig,
  LocalStorageDriver,
  RolesService,
  SchemaCache,
  UsersService,
} from '@yunsoft/yuncms-core';
import { createApp } from '../../packages/api/src/app.js';

const ENABLED = process.env.YUNCMS_TEST_MYSQL === '1';
const DESTRUCTIVE = process.env.YUNCMS_TEST_DB_ALLOW_DESTRUCTIVE === '1';

function suffix() {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`.slice(-12);
}

function requireDisposableDatabase(config) {
  if (!DESTRUCTIVE) {
    throw new Error('YUNCMS_TEST_DB_ALLOW_DESTRUCTIVE=1 is required for the integration suite');
  }
  if (!/(test|ci|dev)/i.test(config.database.database)) {
    throw new Error(`Integration DB name must contain test, ci or dev: ${config.database.database}`);
  }
}

async function jsonResponse(response) {
  if (response.status === 204) return null;
  const text = await response.text();
  return text ? JSON.parse(text) : null;
}

test('real MySQL/API flow covers auth, schema, content, public RBAC, files and tokens', {
  skip: !ENABLED,
  timeout: 90_000,
}, async () => {
  const config = loadConfig(process.env);
  requireDisposableDatabase(config);
  const pool = createDatabasePool(config.database);
  const runId = suffix();
  const names = {
    authors: `it_authors_${runId}`,
    articles: `it_articles_${runId}`,
    tags: `it_tags_${runId}`,
    junction: `it_article_tags_${runId}`,
  };
  const email = `integration-${runId}@example.invalid`;
  const password = `Integration-${runId}-Pass!`;
  const storageRoot = await mkdtemp(join(tmpdir(), 'yuncms-integration-'));
  const system = createSystemAccountability();
  let server;
  let adminRoleId;
  let adminUserId;
  let publicPermissionId;
  let uploadedFileId;
  const signatureFileIds = [];
  let apiTokenId;

  try {
    await bootstrapDatabase(pool);
    const publicRole = await ensurePublicRole(pool);
    assert.ok(publicRole.id);

    const adminRole = await new RolesService({ accountability: system, database: pool }).createOne({
      name: `Integration Admin ${runId}`,
      description: 'Temporary integration administrator',
      admin: true,
    });
    adminRoleId = adminRole.id;
    const adminUser = await new UsersService({ accountability: system, database: pool }).createOne({
      email,
      password,
      role: adminRoleId,
      status: 'active',
      emailVerified: true,
    });
    adminUserId = adminUser.id;

    const storage = createStorageRegistry({
      local: new LocalStorageDriver({ root: storageRoot }),
    });
    const app = createApp({
      pool,
      config,
      serviceRegistry: createCoreServiceRegistry(),
      schemaCache: new SchemaCache(),
      emitter: new HookEmitter(),
      storage,
      logger: { info() {}, warn() {}, error() {} },
    });
    server = await new Promise((resolve, reject) => {
      const instance = app.listen(0, '127.0.0.1', () => resolve(instance));
      instance.once('error', reject);
    });
    const address = server.address();
    const origin = `http://127.0.0.1:${address.port}`;

    async function request(path, { token = null, body, headers = {}, ...options } = {}) {
      const finalHeaders = new Headers(headers);
      if (token) finalHeaders.set('authorization', `Bearer ${token}`);
      if (body !== undefined && !(body instanceof Uint8Array) && !finalHeaders.has('content-type')) {
        finalHeaders.set('content-type', 'application/json');
      }
      const response = await fetch(`${origin}${path}`, {
        ...options,
        headers: finalHeaders,
        body: body === undefined
          ? undefined
          : body instanceof Uint8Array
            ? body
            : JSON.stringify(body),
      });
      return { response, payload: await jsonResponse(response) };
    }

    const health = await request('/health');
    assert.equal(health.response.status, 200);
    assert.equal(health.payload.status, 'ok');
    assert.ok(health.response.headers.get('x-request-id'));

    const login = await request('/auth/login', {
      method: 'POST',
      body: { email, password },
    });
    assert.equal(login.response.status, 200);
    let accessToken = login.payload.data.access_token;
    const refreshToken = login.payload.data.refresh_token;
    assert.ok(accessToken);
    assert.ok(refreshToken);

    const refresh = await request('/auth/refresh', {
      method: 'POST',
      body: { refresh_token: refreshToken },
    });
    assert.equal(refresh.response.status, 200);
    accessToken = refresh.payload.data.access_token;

    for (const collection of [names.authors, names.articles, names.tags]) {
      const created = await request('/schema/collections', {
        method: 'POST', token: accessToken, body: { collection },
      });
      assert.equal(created.response.status, 201);
    }

    const authorName = await request(`/schema/collections/${names.authors}/fields`, {
      method: 'POST', token: accessToken, body: { field: 'name', type: 'string', required: true },
    });
    assert.equal(authorName.response.status, 201);
    for (const field of [
      { field: 'title', type: 'string', required: true },
      { field: 'status', type: 'string', required: true },
      { field: 'author_id', type: 'uuid', required: false },
    ]) {
      const created = await request(`/schema/collections/${names.articles}/fields`, {
        method: 'POST', token: accessToken, body: field,
      });
      assert.equal(created.response.status, 201);
    }
    const tagName = await request(`/schema/collections/${names.tags}/fields`, {
      method: 'POST', token: accessToken, body: { field: 'name', type: 'string', required: true },
    });
    assert.equal(tagName.response.status, 201);

    const m2o = await request('/schema/relations/m2o', {
      method: 'POST',
      token: accessToken,
      body: {
        manyCollection: names.articles,
        manyField: 'author_id',
        oneCollection: names.authors,
        onDelete: 'SET NULL',
      },
    });
    assert.equal(m2o.response.status, 201);

    const m2m = await request('/schema/relations/m2m', {
      method: 'POST',
      token: accessToken,
      body: {
        junctionCollection: names.junction,
        leftCollection: names.articles,
        rightCollection: names.tags,
      },
    });
    assert.equal(m2m.response.status, 201);

    const collections = await request('/schema/collections', { token: accessToken });
    const junction = collections.payload.data.find((entry) => entry.collection === names.junction);
    assert.ok(junction);
    assert.equal(Number(junction.hidden), 1);

    const showJunction = await request(`/schema/collections/${names.junction}`, {
      method: 'PATCH', token: accessToken, body: { hidden: false },
    });
    assert.equal(showJunction.response.status, 200);
    assert.equal(Number(showJunction.payload.data.hidden), 0);
    const hideJunction = await request(`/schema/collections/${names.junction}`, {
      method: 'PATCH', token: accessToken, body: { hidden: true },
    });
    assert.equal(Number(hideJunction.payload.data.hidden), 1);

    const author = await request(`/items/${names.authors}`, {
      method: 'POST', token: accessToken, body: { name: 'Ada' },
    });
    assert.equal(author.response.status, 201);
    const authorId = author.payload.data.id;

    const published = await request(`/items/${names.articles}`, {
      method: 'POST', token: accessToken,
      body: { title: 'Published', status: 'published', author_id: authorId },
    });
    const draft = await request(`/items/${names.articles}`, {
      method: 'POST', token: accessToken,
      body: { title: 'Draft', status: 'draft', author_id: authorId },
    });
    assert.equal(published.response.status, 201);
    assert.equal(draft.response.status, 201);

    const filtered = await request(
      `/items/${names.articles}?filter=${encodeURIComponent(JSON.stringify({ status: { _eq: 'published' } }))}&sort=title&limit=1&offset=0`,
      { token: accessToken },
    );
    assert.equal(filtered.response.status, 200);
    assert.equal(filtered.payload.data.length, 1);
    assert.equal(filtered.payload.data[0].title, 'Published');
    assert.equal(Number(filtered.payload.meta.total_count), 1);

    const expanded = await request(`/items/${names.articles}/${published.payload.data.id}?expand=author_id`, {
      token: accessToken,
    });
    assert.equal(expanded.response.status, 200);
    assert.equal(expanded.payload.data.author_id.name, 'Ada');

    const anonymousDenied = await request(`/items/${names.articles}`);
    assert.equal(anonymousDenied.response.status, 403);

    const publicPermission = await request('/permissions', {
      method: 'POST',
      token: accessToken,
      body: {
        role: publicRole.id,
        collection: names.articles,
        action: 'read',
        fields: ['id', 'title', 'status'],
        filter: { status: { _eq: 'published' } },
      },
    });
    assert.equal(publicPermission.response.status, 201);
    publicPermissionId = publicPermission.payload.data.id;

    const anonymousRead = await request(`/items/${names.articles}?sort=title`);
    assert.equal(anonymousRead.response.status, 200);
    assert.equal(anonymousRead.payload.data.length, 1);
    assert.equal(anonymousRead.payload.data[0].title, 'Published');
    assert.equal(Object.hasOwn(anonymousRead.payload.data[0], 'author_id'), false);

    const anonymousWrite = await request(`/items/${names.articles}`, {
      method: 'POST', body: { title: 'Nope', status: 'published' },
    });
    assert.equal(anonymousWrite.response.status, 403);

    const tokenCreated = await request('/auth/tokens', {
      method: 'POST', token: accessToken, body: { name: `integration-${runId}` },
    });
    assert.equal(tokenCreated.response.status, 201);
    apiTokenId = tokenCreated.payload.data.id;
    const apiToken = tokenCreated.payload.data.token;
    const tokenRead = await request(`/items/${names.articles}?limit=1`, { token: apiToken });
    assert.equal(tokenRead.response.status, 200);

    const fileBytes = new TextEncoder().encode(`integration-file-${runId}`);
    const uploaded = await request('/files', {
      method: 'POST',
      token: accessToken,
      headers: {
        'content-type': 'application/octet-stream',
        'x-filename': encodeURIComponent(`integration-${runId}.txt`),
        'x-mimetype': 'text/plain',
      },
      body: fileBytes,
    });
    assert.equal(uploaded.response.status, 201);
    uploadedFileId = uploaded.payload.data.id;

    const fileList = await request('/files', { token: accessToken });
    assert.equal(fileList.response.status, 200);
    assert.ok(fileList.payload.data.some((file) => file.id === uploadedFileId));

    const fileContentResponse = await fetch(`${origin}/files/${uploadedFileId}/content`, {
      headers: { authorization: `Bearer ${accessToken}` },
    });
    assert.equal(fileContentResponse.status, 200);
    assert.equal(await fileContentResponse.text(), `integration-file-${runId}`);

    const signatureFixtures = [
      ['fixture.pdf', 'application/pdf', new TextEncoder().encode('%PDF-1.4\n%%EOF\n')],
      ['fixture.png', 'image/png', Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00])],
      ['fixture.jpg', 'image/jpeg', Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0x00])],
      ['fixture.gif', 'image/gif', new TextEncoder().encode('GIF89a\u0001\u0000\u0001\u0000')],
      ['fixture.webp', 'image/webp', Uint8Array.from([0x52, 0x49, 0x46, 0x46, 0x04, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50, 0x00])],
    ];
    for (const [filename, mimetype, bytes] of signatureFixtures) {
      const signatureUpload = await request('/files', {
        method: 'POST',
        token: accessToken,
        headers: {
          'content-type': 'application/octet-stream',
          'x-filename': encodeURIComponent(`${runId}-${filename}`),
          'x-mimetype': mimetype,
        },
        body: bytes,
      });
      assert.equal(signatureUpload.response.status, 201, `${mimetype} signature should be accepted`);
      signatureFileIds.push(signatureUpload.payload.data.id);
    }

    const mismatchedFilename = `${runId}-spoofed.png`;
    const mismatchedSignature = await request('/files', {
      method: 'POST',
      token: accessToken,
      headers: {
        'content-type': 'application/octet-stream',
        'x-filename': encodeURIComponent(mismatchedFilename),
        'x-mimetype': 'image/png',
      },
      body: new TextEncoder().encode('not a PNG file'),
    });
    assert.equal(mismatchedSignature.response.status, 400);
    assert.equal(mismatchedSignature.payload.errors[0].code, 'FILE_MIME_MISMATCH');
    const [mismatchedRows] = await pool.query(
      'SELECT id FROM yuncms_files WHERE filename_download = ?',
      [mismatchedFilename],
    );
    assert.deepEqual(mismatchedRows, []);

    const filePatch = await request(`/files/${uploadedFileId}`, {
      method: 'PATCH', token: accessToken,
      body: { title: 'Integration file', filenameDownload: `renamed-${runId}.txt` },
    });
    assert.equal(filePatch.response.status, 200);
    assert.equal(filePatch.payload.data.title, 'Integration file');

    const invalidJson = await fetch(`${origin}/items/${names.articles}`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${accessToken}`,
        'content-type': 'application/json',
        'x-request-id': `integration:${runId}`,
      },
      body: '{broken',
    });
    assert.equal(invalidJson.status, 400);
    assert.equal(invalidJson.headers.get('x-request-id'), `integration:${runId}`);
    const invalidPayload = await invalidJson.json();
    assert.equal(invalidPayload.errors[0].code, 'INVALID_PAYLOAD');
    assert.equal(invalidPayload.errors[0].request_id, `integration:${runId}`);

    const tokenDeleted = await request(`/auth/tokens/${apiTokenId}`, {
      method: 'DELETE', token: accessToken,
    });
    assert.equal(tokenDeleted.response.status, 204);
    apiTokenId = null;

    for (const signatureFileId of signatureFileIds.splice(0)) {
      const deleted = await request(`/files/${signatureFileId}`, {
        method: 'DELETE', token: accessToken,
      });
      assert.equal(deleted.response.status, 204);
    }

    const fileDeleted = await request(`/files/${uploadedFileId}`, {
      method: 'DELETE', token: accessToken,
    });
    assert.equal(fileDeleted.response.status, 204);
    uploadedFileId = null;

    const permissionDeleted = await request(`/permissions/${publicPermissionId}`, {
      method: 'DELETE', token: accessToken,
    });
    assert.equal(permissionDeleted.response.status, 204);
    publicPermissionId = null;

    const m2mDeleted = await request(`/schema/relations/m2m/${names.junction}?destructive=true`, {
      method: 'DELETE', token: accessToken,
    });
    assert.equal(m2mDeleted.response.status, 204);
    const m2oDeleted = await request(`/schema/relations/m2o/${names.articles}/author_id`, {
      method: 'DELETE', token: accessToken,
    });
    assert.equal(m2oDeleted.response.status, 204);

    for (const collection of [names.articles, names.authors, names.tags]) {
      const deleted = await request(`/schema/collections/${collection}?destructive=true`, {
        method: 'DELETE', token: accessToken,
      });
      assert.equal(deleted.response.status, 204);
    }
  } finally {
    if (server) await new Promise((resolve) => server.close(resolve));
    if (publicPermissionId) {
      await pool.query('DELETE FROM yuncms_permissions WHERE id = ?', [publicPermissionId]).catch(() => {});
    }
    if (apiTokenId) await pool.query('DELETE FROM yuncms_api_tokens WHERE id = ?', [apiTokenId]).catch(() => {});
    if (uploadedFileId) await pool.query('DELETE FROM yuncms_files WHERE id = ?', [uploadedFileId]).catch(() => {});
    for (const signatureFileId of signatureFileIds) {
      await pool.query('DELETE FROM yuncms_files WHERE id = ?', [signatureFileId]).catch(() => {});
    }
    for (const collection of [names.junction, names.articles, names.authors, names.tags]) {
      await pool.query(`DROP TABLE IF EXISTS \`${collection}\``).catch(() => {});
      await pool.query('DELETE FROM yuncms_collections WHERE collection = ?', [collection]).catch(() => {});
    }
    if (adminUserId) {
      await pool.query('DELETE FROM yuncms_sessions WHERE user = ?', [adminUserId]).catch(() => {});
      await pool.query('DELETE FROM yuncms_api_tokens WHERE user = ?', [adminUserId]).catch(() => {});
      await pool.query('DELETE FROM yuncms_users WHERE id = ?', [adminUserId]).catch(() => {});
    }
    if (adminRoleId) await pool.query('DELETE FROM yuncms_roles WHERE id = ?', [adminRoleId]).catch(() => {});
    await pool.end().catch(() => {});
    await rm(storageRoot, { recursive: true, force: true });
  }
});
