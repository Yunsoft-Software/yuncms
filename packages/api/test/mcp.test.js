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

test('MCP access guard rejects unauthenticated and untrusted browser origins', () => {
  const guard = createMcpAccessGuard({
    requireAuthentication: true,
    allowedOrigins: ['https://studio.example.test'],
  });
  const response = () => ({
    statusCode: 200,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  });

  const publicRes = response();
  guard({ authMethod: 'public', id: 'r1', get: () => null }, publicRes, () => assert.fail('must not continue'));
  assert.equal(publicRes.statusCode, 401);

  const originRes = response();
  guard({ authMethod: 'api_token', id: 'r2', get: (name) => name === 'origin' ? 'https://evil.example.test' : null }, originRes, () => assert.fail('must not continue'));
  assert.equal(originRes.statusCode, 403);

  let continued = false;
  guard({ authMethod: 'api_token', id: 'r3', get: (name) => name === 'origin' ? 'https://studio.example.test' : null }, response(), () => { continued = true; });
  assert.equal(continued, true);
});
