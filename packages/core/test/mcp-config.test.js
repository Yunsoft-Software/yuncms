import assert from 'node:assert/strict';
import test from 'node:test';

import { loadConfig } from '../src/config.js';

test('MCP is opt-in, authenticated and read-only by default', () => {
  const config = loadConfig({});
  assert.equal(config.mcp.enabled, false);
  assert.equal(config.mcp.writesEnabled, false);
  assert.equal(config.mcp.requireAuthentication, true);
  assert.equal(config.mcp.maxItems, 100);
  assert.equal(config.mcp.maxResultBytes, 1_000_000);
  assert.deepEqual(config.mcp.allowedOrigins, ['http://localhost:3008']);
});

test('MCP origin allowlist normalizes origins and limits can be configured', () => {
  const config = loadConfig({
    STUDIO_ORIGIN: 'https://studio.example.test',
    MCP_ENABLED: 'true',
    MCP_WRITES_ENABLED: 'true',
    MCP_REQUIRE_AUTHENTICATION: 'false',
    MCP_ALLOWED_ORIGINS: 'https://app.example.test/path,https://app.example.test,https://other.example.test',
    MCP_MAX_ITEMS: '25',
    MCP_MAX_RESULT_BYTES: '250000',
  });
  assert.equal(config.mcp.enabled, true);
  assert.equal(config.mcp.writesEnabled, true);
  assert.equal(config.mcp.requireAuthentication, false);
  assert.equal(config.mcp.maxItems, 25);
  assert.equal(config.mcp.maxResultBytes, 250000);
  assert.deepEqual(config.mcp.allowedOrigins, [
    'https://app.example.test',
    'https://other.example.test',
  ]);
});

test('MCP origin allowlist rejects non-http origins', () => {
  assert.throws(
    () => loadConfig({ MCP_ALLOWED_ORIGINS: 'file:///tmp/test' }),
    /must use http or https/,
  );
});
