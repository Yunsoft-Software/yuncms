import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createMcpAccessGuard,
  createToolResult,
  READ_TOOL_NAMES,
  registerMcpTools,
  WRITE_TOOL_NAMES,
} from '../src/mcp.js';

function fakeServer() {
  const tools = new Map();
  return {
    tools,
    registerTool(name, config, callback) {
      tools.set(name, { config, callback });
    },
  };
}

function fakeRequest(ItemsService = class {}) {
  return {
    id: 'req-1',
    authMethod: 'api_token',
    accountability: { user: 'user-1', role: 'role-1', admin: false, system: false },
    context: {
      services: {
        ItemsService,
        PermissionsService: class {},
      },
      database: {},
      schema: { collections: {}, relationByManyField: new Map() },
      logger: console,
      emitter: null,
      storage: null,
      permissionCache: null,
    },
  };
}

function response() {
  return {
    statusCode: 200,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
}

function guardRequest({ authMethod = 'api_token', host = 'api.example.test', origin = null, id = 'r1' } = {}) {
  return {
    authMethod,
    id,
    get(name) {
      if (name === 'host') return host;
      if (name === 'origin') return origin;
      return null;
    },
  };
}

test('MCP registers read tools without write tools by default', () => {
  const server = fakeServer();
  registerMcpTools(server, fakeRequest(), { writesEnabled: false });
  assert.deepEqual([...server.tools.keys()], READ_TOOL_NAMES);
  for (const name of WRITE_TOOL_NAMES) assert.equal(server.tools.has(name), false);
});

test('MCP write tools preserve request accountability when explicitly enabled', async () => {
  let constructed = null;
  class ItemsService {
    constructor(collection, options) {
      constructed = { collection, options };
    }
    async createOne(data) {
      return { id: 'item-1', ...data };
    }
  }
  const req = fakeRequest(ItemsService);
  const server = fakeServer();
  registerMcpTools(server, req, { writesEnabled: true });
  assert.deepEqual([...server.tools.keys()], [...READ_TOOL_NAMES, ...WRITE_TOOL_NAMES]);

  const result = await server.tools.get('items.create').callback({
    collection: 'articles',
    data: { title: 'Hello' },
  });
  assert.equal(constructed.collection, 'articles');
  assert.equal(constructed.options.accountability, req.accountability);
  assert.deepEqual(result.structuredContent, {
    data: { id: 'item-1', title: 'Hello' },
  });
});

test('MCP result size cap returns a bounded tool error', () => {
  const result = createToolResult({ value: 'x'.repeat(100) }, 20);
  assert.equal(result.isError, true);
  assert.match(result.content[0].text, /MCP_RESULT_TOO_LARGE/);
});

test('MCP access guard rejects untrusted hosts, origins and unauthenticated access', () => {
  const guard = createMcpAccessGuard({
    requireAuthentication: true,
    allowedHosts: ['api.example.test'],
    allowedOrigins: ['https://studio.example.test'],
  });

  const hostRes = response();
  guard(guardRequest({ host: 'evil.example.test' }), hostRes, () => assert.fail('must not continue'));
  assert.equal(hostRes.statusCode, 403);
  assert.equal(hostRes.body.errors[0].code, 'MCP_HOST_FORBIDDEN');

  const missingHostRes = response();
  guard(guardRequest({ host: '' }), missingHostRes, () => assert.fail('must not continue'));
  assert.equal(missingHostRes.statusCode, 403);

  const originRes = response();
  guard(guardRequest({ origin: 'https://evil.example.test' }), originRes, () => assert.fail('must not continue'));
  assert.equal(originRes.statusCode, 403);
  assert.equal(originRes.body.errors[0].code, 'MCP_ORIGIN_FORBIDDEN');

  const publicRes = response();
  guard(guardRequest({ authMethod: 'public', origin: 'https://studio.example.test' }), publicRes, () => assert.fail('must not continue'));
  assert.equal(publicRes.statusCode, 401);

  let continued = false;
  guard(guardRequest({ origin: 'https://studio.example.test' }), response(), () => { continued = true; });
  assert.equal(continued, true);
});

test('MCP non-browser requests are accepted only when the Host header is trusted', () => {
  const guard = createMcpAccessGuard({
    requireAuthentication: true,
    allowedHosts: ['api.example.test:3008'],
    allowedOrigins: ['https://studio.example.test'],
  });
  let continued = false;
  guard(guardRequest({ host: 'API.EXAMPLE.TEST:3008', origin: null }), response(), () => { continued = true; });
  assert.equal(continued, true);
});
