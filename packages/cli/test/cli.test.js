import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';

import { assertSupportedNode, runCli } from '../src/cli.js';
import { serializeEnv } from '../src/env-file.js';
import { runStartCommand } from '../src/start-command.js';

test('node guard accepts only node 24 baseline', () => {
  assert.doesNotThrow(() => assertSupportedNode('24.8.0'));
  assert.throws(
    () => assertSupportedNode('22.20.0'),
    (error) => error.code === 'UNSUPPORTED_NODE_VERSION',
  );
});

test('help advertises init, bootstrap and start', async () => {
  const lines = [];
  await runCli(['help'], { output: { log: (line) => lines.push(line) }, env: {} });
  const help = lines.join('\n');

  assert.match(help, /yuncms init/);
  assert.match(help, /yuncms bootstrap/);
  assert.match(help, /yuncms start/);
});

test('start command receives current environment and working directory', async () => {
  const calls = [];
  const result = await runCli(['start'], {
    output: { log() {} },
    env: { DB_HOST: 'db.internal' },
    cwd: '/srv/yuncms-project',
    startCommand: async (options) => {
      calls.push(options);
      return { code: 0 };
    },
  });

  assert.deepEqual(result, { code: 0 });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].cwd, '/srv/yuncms-project');
  assert.equal(calls[0].env.DB_HOST, 'db.internal');
});

test('start command forwards shutdown signals and waits for a clean child exit', async () => {
  const signalSource = new EventEmitter();
  const child = new EventEmitter();
  child.exitCode = null;
  child.signalCode = null;
  child.kill = (signal) => {
    assert.equal(signal, 'SIGTERM');
    child.exitCode = 0;
    queueMicrotask(() => child.emit('exit', 0, null));
    return true;
  };
  let spawnOptions;

  const resultPromise = runStartCommand({
    env: { DB_HOST: 'db.internal' },
    cwd: '/srv/yuncms-project',
    output: { log() {} },
    signalSource,
    spawnProcess(_runtime, _args, options) {
      spawnOptions = options;
      return child;
    },
  });
  signalSource.emit('SIGTERM');

  assert.deepEqual(await resultPromise, { code: 0, signal: null });
  assert.equal(spawnOptions.cwd, '/srv/yuncms-project');
  assert.equal(spawnOptions.detached, process.platform !== 'win32');
  assert.equal(signalSource.listenerCount('SIGTERM'), 0);
  assert.equal(signalSource.listenerCount('SIGINT'), 0);
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
