import assert from 'node:assert/strict';
import test from 'node:test';

import {
  mcpAdminSettingsFromRow,
  normalizeMcpHosts,
  normalizeMcpOrigins,
  normalizeMcpSettingsPatch,
} from '../src/mcp/config.js';
import { McpSettingsStore } from '../src/mcp/settings-store.js';

function createDatabase(overrides = {}) {
  const state = {
    id: 1,
    enabled: 0,
    writes_enabled: 0,
    require_authentication: 1,
    allowed_origins: '[]',
    allowed_hosts: '[]',
    max_items: 100,
    max_result_bytes: 1_000_000,
    updated_at: null,
    ...overrides,
  };
  return {
    state,
    async query(sql, params = []) {
      if (/^\s*SELECT id, enabled/.test(sql)) return [[{ ...state }]];
      if (/^\s*UPDATE yuncms_mcp_settings SET/.test(sql)) {
        const assignments = sql.match(/SET ([\s\S]+) WHERE id = \?/)[1]
          .split(',')
          .map((part) => part.trim().split(' = ')[0]);
        assignments.forEach((column, index) => { state[column] = params[index]; });
        return [{ affectedRows: 1 }];
      }
      throw new Error(`Unexpected SQL in test: ${sql}`);
    },
  };
}

test('MCP panel values normalize exact origins, hosts and limits', () => {
  assert.deepEqual(normalizeMcpOrigins([
    'https://Studio.Example.test/path',
    'https://studio.example.test',
    'http://localhost:3008',
  ]), ['https://studio.example.test', 'http://localhost:3008']);
  assert.deepEqual(normalizeMcpHosts('API.EXAMPLE.TEST:8443\napi.example.test:8443,localhost:3008'), [
    'api.example.test:8443',
    'localhost:3008',
  ]);
  assert.deepEqual(normalizeMcpSettingsPatch({ max_items: 25, max_result_bytes: 250_000 }), {
    maxItems: 25,
    maxResultBytes: 250_000,
  });
});

test('MCP panel rejects invalid origins, hosts and unsupported settings', () => {
  assert.throws(() => normalizeMcpOrigins(['file:///tmp/test']), (error) => error.code === 'INVALID_MCP_CONFIG');
  assert.throws(() => normalizeMcpHosts(['https://api.example.test']), (error) => error.code === 'INVALID_MCP_CONFIG');
  assert.throws(() => normalizeMcpHosts(['user@api.example.test']), (error) => error.code === 'INVALID_MCP_CONFIG');
  assert.throws(() => normalizeMcpSettingsPatch({ unknown: true }), (error) => error.code === 'INVALID_MCP_CONFIG');
});

test('MCP settings are disabled, authenticated and read-only by default', () => {
  const settings = mcpAdminSettingsFromRow(createDatabase().state);
  assert.deepEqual(settings, {
    enabled: false,
    writes_enabled: false,
    require_authentication: true,
    allowed_origins: [],
    allowed_hosts: [],
    max_items: 100,
    max_result_bytes: 1_000_000,
    updated_at: null,
  });
});

test('MCP settings store persists panel changes and applies them to runtime reads', async () => {
  const database = createDatabase();
  const store = new McpSettingsStore({ database });
  const admin = await store.update({
    enabled: true,
    writes_enabled: true,
    require_authentication: false,
    allowed_origins: ['https://studio.example.test'],
    allowed_hosts: ['api.example.test:8443'],
    max_items: 25,
    max_result_bytes: 250_000,
  });
  assert.equal(admin.enabled, true);
  assert.equal(admin.writes_enabled, true);
  assert.equal(admin.require_authentication, false);
  const runtime = await store.readRuntime();
  assert.equal(runtime.enabled, true);
  assert.equal(runtime.writesEnabled, true);
  assert.deepEqual(runtime.allowedHosts, ['api.example.test:8443']);
  assert.equal(runtime.maxItems, 25);
});

test('MCP cannot be enabled without an explicit allowed host', async () => {
  const store = new McpSettingsStore({ database: createDatabase() });
  await assert.rejects(
    () => store.update({ enabled: true }),
    (error) => error.code === 'INVALID_MCP_CONFIG',
  );
});
