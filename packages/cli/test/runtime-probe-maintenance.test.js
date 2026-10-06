import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import test from 'node:test';

import { MAINTENANCE_BYPASS_ENV } from '@yunsoft/yuncms-core';

import { DEFAULT_PROBE_SHUTDOWN_GRACE_MS, verifyInstalledRuntime } from '../src/runtime-probe.js';
import { ATTACHED_RUNTIME_ENV } from '../src/start-command.js';

function readyChild() {
  const child = new EventEmitter();
  child.stderr = new PassThrough();
  child.kill = (signal) => {
    queueMicrotask(() => child.emit('exit', 0, signal));
    return true;
  };
  return child;
}

test('runtime probe passes maintenance bypass token only to its child environment', async () => {
  const token = 'd'.repeat(64);
  let childOptions = null;
  const parentEnv = { DB_DATABASE: 'yuncms_test' };
  const child = readyChild();

  const result = await verifyInstalledRuntime({
    cwd: '/srv/yuncms',
    env: parentEnv,
    port: 3008,
    maintenanceBypassToken: token,
    timeoutMs: 1_000,
    spawnProcess(_command, _args, options) {
      childOptions = options;
      return child;
    },
    async fetchFn() {
      return {
        ok: true,
        async json() { return { status: 'ready' }; },
      };
    },
  });

  assert.equal(result.ready, true);
  assert.equal(childOptions.env[MAINTENANCE_BYPASS_ENV], token);
  assert.equal(childOptions.env[ATTACHED_RUNTIME_ENV], '1');
  assert.equal(childOptions.detached, process.platform !== 'win32');
  assert.equal(parentEnv[MAINTENANCE_BYPASS_ENV], undefined);
  assert.equal(parentEnv[ATTACHED_RUNTIME_ENV], undefined);
});

test('runtime probe rejects an invalid maintenance token before spawning', async () => {
  let spawned = false;
  await assert.rejects(
    verifyInstalledRuntime({
      cwd: '/srv/yuncms',
      port: 3008,
      maintenanceBypassToken: 'short',
      spawnProcess() { spawned = true; return readyChild(); },
      async fetchFn() { throw new Error('must not fetch'); },
    }),
    (error) => error.code === 'UPDATE_PROBE_MAINTENANCE_TOKEN_INVALID',
  );
  assert.equal(spawned, false);
});

test('runtime probe bounds shutdown when the ready child ignores TERM and KILL', async () => {
  const child = new EventEmitter();
  const signals = [];
  child.stderr = new PassThrough();
  child.kill = (signal) => {
    signals.push(signal);
    return true;
  };

  await assert.rejects(
    verifyInstalledRuntime({
      cwd: '/srv/yuncms',
      port: 3008,
      timeoutMs: 1_000,
      shutdownGraceMs: 10,
      spawnProcess() { return child; },
      async fetchFn() {
        return {
          ok: true,
          async json() { return { status: 'ready' }; },
        };
      },
    }),
    (error) => error.code === 'UPDATE_PROBE_SHUTDOWN_TIMEOUT',
  );

  assert.deepEqual(signals, ['SIGTERM', 'SIGKILL']);
});

test('probe preserves shutdown failure code separately from subprocess exit code', async () => {
  const child = readyChild();
  child.kill = () => {
    queueMicrotask(() => child.emit('exit', null, 'SIGKILL'));
    return true;
  };
  await assert.rejects(verifyInstalledRuntime({
    port: 3008, spawnProcess: () => child,
    fetchFn: async () => ({ ok: true, json: async () => ({ status: 'ready' }) }),
  }), (error) => error.code === 'UPDATE_PROBE_SHUTDOWN_FAILED'
    && error.exitCode === null && error.signal === 'SIGKILL');
});

test('probe preserves early exit code separately from subprocess exit code', async () => {
  const child = readyChild();
  await assert.rejects(verifyInstalledRuntime({
    port: 3008,
    spawnProcess() { queueMicrotask(() => child.emit('exit', 17, null)); return child; },
    fetchFn: async () => { throw new Error('must not fetch'); },
  }), (error) => error.code === 'UPDATE_PROBE_EXITED' && error.exitCode === 17);
});

test('default probe grace allows a job longer than the former three second budget', async () => {
  assert.equal(DEFAULT_PROBE_SHUTDOWN_GRACE_MS, 12_000);
  const child = readyChild();
  const signals = [];
  child.kill = (signal) => {
    signals.push(signal);
    if (signal === 'SIGTERM') setTimeout(() => child.emit('exit', 0, null), 3_200);
    else queueMicrotask(() => child.emit('exit', null, signal));
    return true;
  };
  const result = await verifyInstalledRuntime({
    port: 3008, spawnProcess: () => child,
    fetchFn: async () => ({ ok: true, json: async () => ({ status: 'ready' }) }),
  });
  assert.equal(result.ready, true);
  assert.deepEqual(signals, ['SIGTERM']);
});
