import assert from 'node:assert/strict';
import { request as httpRequest } from 'node:http';
import { createServer as createNetServer } from 'node:net';
import test from 'node:test';

import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import {
  ApiTokensService,
  AuditService,
  bootstrapDatabase,
  closeDatabasePool,
  CollectionsService,
  createCoreServiceRegistry,
  createDatabasePool,
  createSystemAccountability,
  FieldsService,
  HookEmitter,
  ItemsService,
  loadConfig,
  PermissionsService,
  quoteIdentifier,
  RelationsService,
  RolesService,
  SchemaCache,
  UsersService,
} from '@yunsoft/yuncms-core';
import { createApp } from '../../packages/api/src/app.js';
import { createMcpRouter, READ_TOOL_NAMES, WRITE_TOOL_NAMES } from '../../packages/api/src/mcp.js';

const ENABLED = process.env.YUNCMS_TEST_MYSQL === '1';
const DESTRUCTIVE = process.env.YUNCMS_TEST_DB_ALLOW_DESTRUCTIVE === '1';

function requireDisposableDatabase(config) {
  if (!DESTRUCTIVE) throw new Error('YUNCMS_TEST_DB_ALLOW_DESTRUCTIVE=1 is required');
  if (!/(test|ci|dev)/i.test(config.database.database)) {
    throw new Error(`Integration DB name must contain test, ci or dev: ${config.database.database}`);
  }
}

function suffix() {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`.slice(-9);
}

function listen(app, port = 0) {
  return new Promise((resolve, reject) => {
    const server = app.listen(port, '127.0.0.1', () => resolve(server));
    server.once('error', reject);
  });
}

function availablePort() {
  return new Promise((resolve, reject) => {
    const reservation = createNetServer();
    reservation.listen(0, '127.0.0.1', () => {
      const port = reservation.address().port;
      reservation.close((error) => (error ? reject(error) : resolve(port)));
    });
    reservation.once('error', reject);
  });
}

function closeServer(server) {
  if (!server) return Promise.resolve();
  return new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
}

function rawMcpPost(port, { host, origin = null, token = null } = {}) {
  const body = JSON.stringify({});
  const headers = {
    'content-type': 'application/json',
    'content-length': Buffer.byteLength(body),
  };
  if (host != null) headers.host = host;
  if (origin != null) headers.origin = origin;
  if (token != null) headers.authorization = `Bearer ${token}`;

  return new Promise((resolve, reject) => {
    const request = httpRequest({
      hostname: '127.0.0.1',
      port,
      path: '/mcp',
      method: 'POST',
      setHost: false,
      headers,
    }, (response) => {
      const chunks = [];
      response.on('data', (chunk) => chunks.push(chunk));
      response.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        resolve({ status: response.statusCode, body: text ? JSON.parse(text) : null });
      });
    });
    request.once('error', reject);
    request.end(body);
  });
}

function mcpConfig(env, { writesEnabled, allowedHost }) {
  return loadConfig({
    ...env,
    API_RATE_LIMIT_ENABLED: 'false',
    MCP_ENABLED: 'true',
    MCP_WRITES_ENABLED: writesEnabled ? 'true' : 'false',
    MCP_REQUIRE_AUTHENTICATION: 'true',
    MCP_ALLOWED_HOSTS: allowedHost,
    MCP_ALLOWED_ORIGINS: 'http://studio.integration.test',
    MCP_MAX_ITEMS: '100',
    MCP_MAX_RESULT_BYTES: '10000',
  });
}

async function connectClient(port, token, { origin = null } = {}) {
  const headers = {};
  if (origin) headers.origin = origin;
  const transport = new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${port}/mcp`), {
    authProvider: { token: async () => token },
    requestInit: { headers },
  });
  const client = new Client(
    { name: 'yuncms-integration-client', version: '1.0.0' },
    { versionNegotiation: { mode: { pin: '2026-07-28' } } },
  );
  await client.connect(transport);
  return client;
}

function toolPayload(result) {
  const text = result.content?.find((entry) => entry.type === 'text')?.text;
  return text ? JSON.parse(text) : null;
}

test('official MCP v2 client preserves real MySQL RBAC, guards, limits and write accountability', {
  skip: !ENABLED,
  timeout: 90_000,
}, async () => {
  const baseConfig = loadConfig(process.env);
  requireDisposableDatabase(baseConfig);
  const pool = createDatabasePool(baseConfig.database);
  const token = suffix();
  const collection = `it_mcp_${token}`;
  const relatedCollection = `it_mcp_author_${token}`;
  const system = createSystemAccountability();
  const schemaCache = new SchemaCache({ versionCheckTtlMs: 0 });
  const emitter = new HookEmitter({ logger: { error() {} } });
  const logger = { info() {}, warn() {}, error() {} };
  let roleId = null;
  let userId = null;
  let apiTokenId = null;
  let server = null;
  let client = null;

  try {
    await bootstrapDatabase(pool);
    const collections = new CollectionsService({ accountability: system, database: pool });
    await collections.createOne({ collection: relatedCollection });
    await collections.createOne({ collection });
    const fields = new FieldsService({ accountability: system, database: pool });
    await fields.createOne(relatedCollection, { field: 'name', type: 'string', required: true });
    await fields.createOne(relatedCollection, { field: 'visibility', type: 'string', required: true });
    for (const definition of [
      { field: 'title', type: 'string', required: true },
      { field: 'note', type: 'text', required: true },
      { field: 'status', type: 'string', required: true },
      { field: 'secret', type: 'string', required: false },
      { field: 'author_id', type: 'uuid', required: false },
    ]) {
      await fields.createOne(collection, definition);
    }
    await new RelationsService({ accountability: system, database: pool }).createM2O({
      manyCollection: collection,
      manyField: 'author_id',
      oneCollection: relatedCollection,
      onDelete: 'SET NULL',
    });
    schemaCache.clear();

    const relatedItems = new ItemsService(relatedCollection, {
      accountability: system,
      database: pool,
      schemaCache,
    });
    const [visibleAuthor, hiddenAuthor] = await relatedItems.createMany([
      { name: 'Visible author', visibility: 'public' },
      { name: 'Hidden author', visibility: 'private' },
    ]);

    const items = new ItemsService(collection, {
      accountability: system,
      database: pool,
      schemaCache,
    });
    const seeded = await items.createMany([
      ...Array.from({ length: 30 }, (_, index) => ({
        title: `Published ${String(index).padStart(2, '0')}`,
        note: `note-${index}-${'x'.repeat(500)}`,
        status: 'published',
        secret: `secret-${index}`,
        author_id: index === 29 ? hiddenAuthor.id : visibleAuthor.id,
      })),
      {
        title: 'Draft hidden',
        note: 'must not be visible',
        status: 'draft',
        secret: 'draft-secret',
      },
    ]);

    const roles = new RolesService({ accountability: system, database: pool });
    const role = await roles.createOne({ name: `MCP Reader ${token}` });
    roleId = role.id;
    const users = new UsersService({ accountability: system, database: pool });
    const user = await users.createOne({
      email: `mcp-${token}@example.test`,
      password: 'MCP-Integration-Pass-1!',
      role: roleId,
      status: 'active',
      emailVerified: true,
    });
    userId = user.id;
    const permissions = new PermissionsService({
      accountability: system,
      database: pool,
      schemaCache,
      emitter,
    });
    await permissions.createOne({
      role: roleId,
      collection,
      action: 'read',
      fields: ['id', 'title', 'note', 'author_id'],
      filter: { status: { _eq: 'published' } },
    });
    await permissions.createOne({
      role: roleId,
      collection: relatedCollection,
      action: 'read',
      fields: ['id', 'name'],
      filter: { visibility: { _eq: 'public' } },
    });
    const generatedToken = await new ApiTokensService({ accountability: system, database: pool }).createOne({
      user: userId,
      name: `mcp-${token}`,
    });
    apiTokenId = generatedToken.id;

    const readPort = await availablePort();
    const trustedReadHost = `127.0.0.1:${readPort}`;
    const readConfig = mcpConfig(process.env, {
      writesEnabled: false,
      allowedHost: trustedReadHost,
    });
    const readApp = createApp({
      pool,
      config: readConfig,
      serviceRegistry: createCoreServiceRegistry(),
      schemaCache,
      emitter,
      logger,
      mcpRouter: createMcpRouter({ config: readConfig, logger }),
    });
    server = await listen(readApp, readPort);
    const port = server.address().port;

    const missingHost = await rawMcpPost(port, { host: '', token: generatedToken.token });
    assert.equal(missingHost.status, 403);
    assert.equal(missingHost.body.errors[0].code, 'MCP_HOST_FORBIDDEN');
    const wrongHost = await rawMcpPost(port, { host: 'evil.integration.test', token: generatedToken.token });
    assert.equal(wrongHost.status, 403);
    assert.equal(wrongHost.body.errors[0].code, 'MCP_HOST_FORBIDDEN');
    const wrongOrigin = await rawMcpPost(port, {
      host: trustedReadHost,
      origin: 'http://evil.integration.test',
      token: generatedToken.token,
    });
    assert.equal(wrongOrigin.status, 403);
    assert.equal(wrongOrigin.body.errors[0].code, 'MCP_ORIGIN_FORBIDDEN');
    const unauthenticated = await rawMcpPost(port, { host: trustedReadHost });
    assert.equal(unauthenticated.status, 401);
    assert.equal(unauthenticated.body.errors[0].code, 'UNAUTHORIZED');

    const restResponse = await fetch(
      `http://127.0.0.1:${port}/items/${collection}?fields=id,title,author_id.name&sort=title&limit=2`,
      { headers: { authorization: `Bearer ${generatedToken.token}` } },
    );
    assert.equal(restResponse.status, 200);
    const restRead = await restResponse.json();
    assert.equal(restRead.data.length, 2);
    assert.equal(restRead.meta.total_count, 30);

    client = await connectClient(port, generatedToken.token);
    assert.equal(client.getNegotiatedProtocolVersion(), '2026-07-28');
    const readTools = await client.listTools();
    assert.deepEqual(readTools.tools.map((tool) => tool.name).sort(), [...READ_TOOL_NAMES].sort());
    for (const writeTool of WRITE_TOOL_NAMES) {
      assert.equal(readTools.tools.some((tool) => tool.name === writeTool), false);
    }

    const listed = toolPayload(await client.callTool({
      name: 'schema.list_collections',
      arguments: {},
    }));
    assert.deepEqual(listed.data.collections.map((entry) => entry.collection).sort(), [
      collection,
      relatedCollection,
    ].sort());

    const described = toolPayload(await client.callTool({
      name: 'schema.describe_collection',
      arguments: { collection },
    }));
    assert.deepEqual(described.data.fields.map((field) => field.field), ['id', 'title', 'note', 'author_id']);
    assert.deepEqual(described.data.capabilities, {
      read: true,
      create: false,
      update: false,
      delete: false,
    });

    const readMany = toolPayload(await client.callTool({
      name: 'items.read_many',
      arguments: { collection, fields: 'id,title,author_id.name', sort: 'title', limit: 2 },
    }));
    assert.equal(readMany.data.data.length, 2);
    assert.equal(readMany.data.meta.total_count, 30);
    assert.deepEqual(readMany.data, restRead);
    assert.equal(readMany.data.data.every((row) => !Object.hasOwn(row, 'secret')), true);

    const readOne = toolPayload(await client.callTool({
      name: 'items.read_one',
      arguments: { collection, id: seeded[0].id, fields: 'id,title' },
    }));
    assert.equal(readOne.data.id, seeded[0].id);
    const targetFilteredRelation = toolPayload(await client.callTool({
      name: 'items.read_one',
      arguments: { collection, id: seeded[29].id, fields: 'id,author_id.name' },
    }));
    assert.equal(targetFilteredRelation.data.id, seeded[29].id);
    assert.equal(targetFilteredRelation.data.author_id, null);
    const hiddenDraft = await client.callTool({
      name: 'items.read_one',
      arguments: { collection, id: seeded.at(-1).id, fields: 'id,title' },
    });
    assert.equal(toolPayload(hiddenDraft).data, null);

    const oversized = await client.callTool({
      name: 'items.read_many',
      arguments: { collection, fields: 'id,title,note', sort: 'title', limit: 30 },
    });
    assert.equal(oversized.isError, true);
    assert.equal(toolPayload(oversized).error.code, 'MCP_RESULT_TOO_LARGE');

    await client.close();
    client = null;
    await closeServer(server);
    server = null;

    for (const grant of [
      {
        action: 'create',
        fields: ['title', 'note', 'status'],
        validation: { status: { _eq: 'published' } },
      },
      {
        action: 'update',
        fields: ['title', 'note'],
        filter: { status: { _eq: 'published' } },
        validation: { status: { _eq: 'published' } },
      },
      {
        action: 'delete',
        filter: { status: { _eq: 'published' } },
      },
    ]) {
      await permissions.createOne({ role: roleId, collection, ...grant });
    }

    let createHookCalls = 0;
    emitter.registerAction('items.create', async (payload, context) => {
      createHookCalls += 1;
      const audit = new AuditService({
        accountability: system,
        database: pool,
        requestId: context.requestId,
      });
      await audit.record({
        user: context.accountability.user,
        action: 'items.create',
        collection,
        itemKey: payload.key,
        requestId: context.requestId,
        payload,
      });
    }, { extensionId: 'integration.audit', priority: 1000 });
    for (const event of ['items.update', 'items.delete']) {
      emitter.registerAction(event, async (payload, context) => {
        const audit = new AuditService({ accountability: system, database: pool, requestId: context.requestId });
        await audit.record({
          user: context.accountability.user,
          action: event,
          collection,
          itemKey: payload.key,
          requestId: context.requestId,
          payload,
        });
      }, { extensionId: 'integration.audit', priority: 1000 });
    }

    const writePort = await availablePort();
    const writeConfig = mcpConfig(process.env, {
      writesEnabled: true,
      allowedHost: `127.0.0.1:${writePort}`,
    });
    const writeApp = createApp({
      pool,
      config: writeConfig,
      serviceRegistry: createCoreServiceRegistry(),
      schemaCache,
      emitter,
      logger,
      mcpRouter: createMcpRouter({ config: writeConfig, logger }),
    });
    server = await listen(writeApp, writePort);
    client = await connectClient(server.address().port, generatedToken.token, {
      origin: 'http://studio.integration.test',
    });
    assert.equal(client.getNegotiatedProtocolVersion(), '2026-07-28');
    const writeTools = await client.listTools();
    assert.deepEqual(writeTools.tools.map((tool) => tool.name).sort(), [
      ...READ_TOOL_NAMES,
      ...WRITE_TOOL_NAMES,
    ].sort());

    const invalidCreate = await client.callTool({
      name: 'items.create',
      arguments: {
        collection,
        data: { title: 'Rejected', note: 'invalid status', status: 'draft' },
      },
    });
    assert.equal(invalidCreate.isError, true);
    assert.equal(toolPayload(invalidCreate).error.code, 'VALIDATION_FAILED');

    const created = toolPayload(await client.callTool({
      name: 'items.create',
      arguments: {
        collection,
        data: { title: 'Created through MCP', note: 'created', status: 'published' },
      },
    })).data;
    assert.ok(created.id);
    assert.equal(createHookCalls, 1);
    const updated = toolPayload(await client.callTool({
      name: 'items.update',
      arguments: { collection, id: created.id, data: { title: 'Updated through MCP' } },
    })).data;
    assert.equal(updated.title, 'Updated through MCP');
    const deleted = toolPayload(await client.callTool({
      name: 'items.delete',
      arguments: { collection, id: created.id },
    })).data;
    assert.equal(deleted.deleted, true);

    const [auditRows] = await pool.query(
      `SELECT user, action, item_key
       FROM yuncms_audit_log
       WHERE user = ? AND collection = ? AND item_key = ?
       ORDER BY id`,
      [userId, collection, created.id],
    );
    assert.deepEqual(auditRows.map((row) => row.action), [
      'items.create',
      'items.update',
      'items.delete',
    ]);
    assert.equal(auditRows.every((row) => row.user === userId), true);
  } finally {
    if (client) await client.close().catch(() => {});
    if (server) await closeServer(server).catch(() => {});
    await pool.query('DELETE FROM yuncms_audit_log WHERE collection = ?', [collection]).catch(() => {});
    if (apiTokenId) await pool.query('DELETE FROM yuncms_api_tokens WHERE id = ?', [apiTokenId]).catch(() => {});
    if (userId) await pool.query('DELETE FROM yuncms_sessions WHERE user = ?', [userId]).catch(() => {});
    if (userId) await pool.query('DELETE FROM yuncms_users WHERE id = ?', [userId]).catch(() => {});
    if (roleId) await pool.query('DELETE FROM yuncms_permissions WHERE role = ?', [roleId]).catch(() => {});
    if (roleId) await pool.query('DELETE FROM yuncms_roles WHERE id = ?', [roleId]).catch(() => {});
    const table = quoteIdentifier(collection, 'MCP integration cleanup table');
    const relatedTable = quoteIdentifier(relatedCollection, 'MCP integration related cleanup table');
    await pool.query(`DROP TABLE IF EXISTS ${table}`).catch(() => {});
    await pool.query(`DROP TABLE IF EXISTS ${relatedTable}`).catch(() => {});
    await pool.query(
      'DELETE FROM yuncms_relations WHERE many_collection IN (?, ?) OR one_collection IN (?, ?)',
      [collection, relatedCollection, collection, relatedCollection],
    ).catch(() => {});
    await pool.query('DELETE FROM yuncms_collections WHERE collection = ?', [collection]).catch(() => {});
    await pool.query('DELETE FROM yuncms_collections WHERE collection = ?', [relatedCollection]).catch(() => {});
    await closeDatabasePool(pool).catch(() => {});
  }
});
