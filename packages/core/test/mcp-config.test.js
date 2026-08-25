import assert from 'node:assert/strict';
import test from 'node:test';

import { loadConfig } from '../src/config.js';

test('MCP settings are not loaded from environment variables', () => {
  const config = loadConfig({
    MCP_ENABLED: 'true',
    MCP_WRITES_ENABLED: 'true',
    MCP_REQUIRE_AUTHENTICATION: 'false',
    MCP_ALLOWED_ORIGINS: 'https://untrusted.example.test',
    MCP_ALLOWED_HOSTS: 'untrusted.example.test',
    MCP_MAX_ITEMS: '500',
    MCP_MAX_RESULT_BYTES: '10000000',
  });

  assert.equal(Object.hasOwn(config, 'mcp'), false);
});
