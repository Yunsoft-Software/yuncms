import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import test from 'node:test';

import { MAINTENANCE_BYPASS_ENV } from '@yunsoft/yuncms-core';

import { verifyInstalledRuntime } from '../src/runtime-probe.js';

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
  assert.equal(parentEnv[MAINTENANCE_BYPASS_ENV], undefined);
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
