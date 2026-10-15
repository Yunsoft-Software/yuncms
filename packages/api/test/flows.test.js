import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

test('server wiring passes native script configuration to both the API and durable runtime', () => {
  const server = readFileSync(new URL('../src/server.js', import.meta.url), 'utf8');
  assert.match(server, /scripts: config\.flows\.scripts/);
  assert.match(server, /new FlowRuntime\(\{[^;]*\.\.\.flowsOptions/);
  assert.match(server, /flowsOptions,/);
});
