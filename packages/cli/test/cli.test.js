import test from 'node:test';
import assert from 'node:assert/strict';

import { assertSupportedNode, runCli } from '../src/cli.js';
import { serializeEnv } from '../src/env-file.js';

test('node guard accepts only node 24 baseline', () => {
  assert.doesNotThrow(() => assertSupportedNode('24.8.0'));
  assert.throws(
    () => assertSupportedNode('22.20.0'),
    (error) => error.code === 'UNSUPPORTED_NODE_VERSION',
  );
});

test('help advertises init and bootstrap without claiming start exists', async () => {
  const lines = [];
  await runCli(['help'], { output: { log: (line) => lines.push(line) }, env: {} });
  const help = lines.join('\n');

  assert.match(help, /yuncms init/);
  assert.match(help, /yuncms bootstrap/);
  assert.match(help, /start wrapper is planned/);
});

test('env serialization quotes values and rejects multiline secrets', () => {
  const serialized = serializeEnv({
    DB_HOST: '127.0.0.1',
    DB_PASSWORD: 'space # quote " slash \\',
  });

  assert.match(serialized, /DB_HOST="127\.0\.0\.1"/);
  assert.match(serialized, /DB_PASSWORD="space # quote \\" slash \\\\"/);
  assert.throws(() => serializeEnv({ DB_PASSWORD: 'line1\nline2' }), /cannot contain newlines/);
});

test('unknown commands fail closed', async () => {
  await assert.rejects(
    runCli(['graphql'], { output: { log() {} }, env: {} }),
    (error) => error.code === 'UNKNOWN_CLI_COMMAND',
  );
});
