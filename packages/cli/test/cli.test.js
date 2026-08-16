import test from 'node:test';
import assert from 'node:assert/strict';

import { assertSupportedNode, runCli } from '../src/cli.js';

test('node guard accepts only node 24 baseline', () => {
  assert.doesNotThrow(() => assertSupportedNode('24.8.0'));
  assert.throws(
    () => assertSupportedNode('22.20.0'),
    (error) => error.code === 'UNSUPPORTED_NODE_VERSION',
  );
});

test('help command has no database side effects', async () => {
  const lines = [];
  await runCli(['help'], { output: { log: (line) => lines.push(line) }, env: {} });
  assert.match(lines.join('\n'), /yuncms bootstrap/);
});

test('unknown commands fail closed', async () => {
  await assert.rejects(
    runCli(['graphql'], { output: { log() {} }, env: {} }),
    (error) => error.code === 'UNKNOWN_CLI_COMMAND',
  );
});
