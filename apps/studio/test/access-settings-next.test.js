import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';

const SRC = resolve(import.meta.dirname, '../src');
const studioCss = readFileSync(resolve(SRC, 'studio.css'), 'utf8');
const css = readFileSync(resolve(SRC, 'users-mcp-next.css'), 'utf8');

test('Users and MCP workspace layer is loaded after shared Studio tokens', () => {
  const tokenIndex = studioCss.indexOf("@import './studio-next-tokens.css';");
  const usersMcpIndex = studioCss.indexOf("@import './users-mcp-next.css';");
  assert.ok(tokenIndex > -1);
  assert.ok(usersMcpIndex > tokenIndex);
});

test('Users uses one dense identity table with responsive detail controls', () => {
  assert.match(css, /\.users-table-panel/);
  assert.match(css, /\.user-identity-cell/);
  assert.match(css, /\.user-detail-controls[\s\S]*grid-template-columns/);
  assert.match(css, /\.verification-pill\.verified/);
});

test('MCP reads as an integration settings surface with explicit warning states', () => {
  assert.match(css, /\.mcp-endpoint-card/);
  assert.match(css, /\.mcp-toggle-grid[\s\S]*repeat\(3, minmax\(0, 1fr\)\)/);
  assert.match(css, /\.mcp-toggle\.warning/);
  assert.match(css, /\.mcp-warning\.danger/);
});
