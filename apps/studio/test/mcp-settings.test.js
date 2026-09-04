import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  mcpFormFromSettings,
  mcpSettingsPatch,
  splitMcpList,
} from '../src/mcp-settings.js';

const appSource = await readFile(new URL('../src/App.jsx', import.meta.url), 'utf8');
const apiSource = await readFile(new URL('../src/api.js', import.meta.url), 'utf8');
const screenSource = await readFile(new URL('../src/screens/McpScreen.jsx', import.meta.url), 'utf8');
const routeSource = await readFile(new URL('../src/studio-route.js', import.meta.url), 'utf8');
const mainSource = await readFile(new URL('../src/main.jsx', import.meta.url), 'utf8');
const studioCss = await readFile(new URL('../src/studio.css', import.meta.url), 'utf8');

test('MCP form uses current browser boundaries until explicit values are saved', () => {
  assert.deepEqual(mcpFormFromSettings({
    enabled: false,
    writes_enabled: false,
    require_authentication: true,
    allowed_origins: [],
    allowed_hosts: [],
    max_items: 100,
    max_result_bytes: 1_000_000,
  }, {
    origin: 'http://localhost:3008',
    host: 'localhost:3008',
  }), {
    enabled: false,
    writesEnabled: false,
    requireAuthentication: true,
    allowedOrigins: 'http://localhost:3008',
    allowedHosts: 'localhost:3008',
    maxItems: 100,
    maxResultBytes: 1_000_000,
  });
});

test('MCP form patch normalizes panel lists and numeric limits', () => {
  assert.deepEqual(splitMcpList('api.example.test\napi.example.test, localhost:3008'), [
    'api.example.test',
    'localhost:3008',
  ]);
  assert.deepEqual(mcpSettingsPatch({
    enabled: true,
    writesEnabled: true,
    requireAuthentication: false,
    allowedOrigins: 'https://studio.example.test',
    allowedHosts: 'api.example.test',
    maxItems: '25',
    maxResultBytes: '250000',
  }), {
    enabled: true,
    writes_enabled: true,
    require_authentication: false,
    allowed_origins: ['https://studio.example.test'],
    allowed_hosts: ['api.example.test'],
    max_items: 25,
    max_result_bytes: 250_000,
  });
});

test('Studio exposes administrator-only MCP settings backed by dedicated API routes', () => {
  assert.match(routeSource, /'mcp'/);
  assert.match(routeSource, /mcp:\s*\(\)\s*=>\s*'#\/mcp'/);
  assert.match(appSource, /import \{ McpScreen \}/);
  assert.match(appSource, /adminOnly:\s*true/);
  assert.match(appSource, /session\.user\?\.admin/);
  assert.match(appSource, /<McpScreen \/>/);
  assert.match(apiSource, /export async function mcpSettings/);
  assert.match(apiSource, /export async function saveMcpSettings/);
  assert.match(apiSource, /'\/mcp\/settings'/);
  assert.match(screenSource, /mcpSettingsPatch\(form\)/);
  assert.match(screenSource, /form\.writesEnabled/);
  assert.match(screenSource, /!form\.requireAuthentication/);
  assert.match(mainSource, /import '\.\/studio\.css'/);
  assert.match(studioCss, /@import '\.\/mcp\.css';/);
});
