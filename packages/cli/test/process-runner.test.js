import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import test from 'node:test';

import { resolveCommandTimeoutMs, runCapturedProcess } from '../src/process-runner.js';

function fakeChild({ onKill = null } = {}) {
  const child = new EventEmitter();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.kill = (signal) => {
    onKill?.(signal, child);
    return true;
  };
  return child;
}

test('command runner captures bounded output from a successful process', async () => {
  const child = fakeChild();
  const promise = runCapturedProcess('fixture', ['ok'], {
    timeoutMs: 1_000,
    maxOutputBytes: 5,
    spawnProcess() {
      queueMicrotask(() => {
        child.stdout.write('abcdefgh');
        child.stderr.write('warning');
        child.emit('exit', 0, null);
      });
      return child;
    },
  });

  const result = await promise;
  assert.equal(result.stdout, 'abcde');
  assert.equal(result.stderr, 'warni');
  assert.equal(result.code, 0);
});

test('command runner resolves npm and npx through Windows command shims', async () => {
  for (const command of ['npm', 'npx']) {
    const child = fakeChild();
    let spawnedCommand = null;
    const promise = runCapturedProcess(command, ['--version'], {
      platform: 'win32',
      timeoutMs: 1_000,
      spawnProcess(actualCommand) {
        spawnedCommand = actualCommand;
        queueMicrotask(() => child.emit('exit', 0, null));
        return child;
      },
    });

    await promise;
    assert.equal(spawnedCommand, `${command}.cmd`);
  }
});

test('command runner terminates a timed-out process and reports COMMAND_TIMEOUT', async () => {
  const signals = [];
  const child = fakeChild({
    onKill(signal, instance) {
      signals.push(signal);
      if (signal === 'SIGKILL') queueMicrotask(() => instance.emit('exit', null, 'SIGKILL'));
    },
  });

  await assert.rejects(
    runCapturedProcess('fixture', ['hang'], {
      timeoutMs: 20,
      killGraceMs: 10,
      spawnProcess() { return child; },
    }),
    (error) => error.code === 'COMMAND_TIMEOUT'
      && error.command === 'fixture'
      && error.timeoutMs === 20,
  );

  assert.deepEqual(signals, ['SIGTERM', 'SIGKILL']);
});

test('command runner still rejects in bounded time if a child never reports exit after SIGKILL', async () => {
  const signals = [];
  const child = fakeChild({ onKill(signal) { signals.push(signal); } });
  const started = Date.now();

  await assert.rejects(
    runCapturedProcess('fixture', ['stuck'], {
      timeoutMs: 20,
      killGraceMs: 10,
      spawnProcess() { return child; },
    }),
    (error) => error.code === 'COMMAND_TIMEOUT',
  );

  assert.ok(Date.now() - started < 1_000);
  assert.deepEqual(signals, ['SIGTERM', 'SIGKILL']);
});

test('CLI command timeout environment value is validated before spawning', async () => {
  assert.equal(resolveCommandTimeoutMs({ YUNCMS_CLI_COMMAND_TIMEOUT_MS: '1234' }), 1234);
  assert.throws(
    () => resolveCommandTimeoutMs({ YUNCMS_CLI_COMMAND_TIMEOUT_MS: '0' }),
    (error) => error.code === 'COMMAND_TIMEOUT_INVALID',
  );

  let spawned = false;
  await assert.rejects(
    runCapturedProcess('fixture', [], {
      env: { YUNCMS_CLI_COMMAND_TIMEOUT_MS: 'not-a-number' },
      spawnProcess() { spawned = true; return fakeChild(); },
    }),
    (error) => error.code === 'COMMAND_TIMEOUT_INVALID',
  );
  assert.equal(spawned, false);
});

test('synchronous process spawn failure is normalized with command context', async () => {
  const startError = new Error('spawn failed');
  await assert.rejects(
    runCapturedProcess('npm', ['view'], {
      spawnProcess() { throw startError; },
    }),
    (error) => error === startError
      && error.code === 'COMMAND_START_FAILED'
      && error.command === 'npm'
      && error.args[0] === 'view',
  );
});
