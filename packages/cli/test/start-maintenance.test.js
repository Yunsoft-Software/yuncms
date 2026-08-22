import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { MAINTENANCE_BYPASS_ENV } from '@yunsoft/yuncms-core';

import { runStartCommand } from '../src/start-command.js';
import { acquireUpdateLock, updateLockPath } from '../src/update-lock.js';

test('normal CLI start is blocked while an operation lock is active', async () => {
  const cwd = await mkdtemp(join(tmpdir(), 'yuncms-start-maintenance-'));
  const lock = await acquireUpdateLock({ cwd });
  let spawned = false;
  try {
    await assert.rejects(
      runStartCommand({
        cwd,
        env: {},
        output: { log() {} },
        spawnProcess() { spawned = true; throw new Error('must not spawn'); },
      }),
      (error) => error.code === 'YUNCMS_MAINTENANCE_ACTIVE',
    );
    assert.equal(spawned, false);
  } finally {
    await lock.release();
    await rm(cwd, { recursive: true, force: true });
  }
});

test('only updater bypass token allows the temporary CLI start path', async () => {
  const cwd = await mkdtemp(join(tmpdir(), 'yuncms-start-maintenance-bypass-'));
  const lock = await acquireUpdateLock({ cwd });
  const child = new EventEmitter();
  child.exitCode = null;
  child.signalCode = null;
  let childEnv = null;
  try {
    const resultPromise = runStartCommand({
      cwd,
      env: { [MAINTENANCE_BYPASS_ENV]: lock.bypassToken },
      output: { log() {} },
      spawnProcess(_command, _args, options) {
        childEnv = options.env;
        queueMicrotask(() => {
          child.exitCode = 0;
          child.emit('exit', 0, null);
        });
        return child;
      },
    });

    assert.deepEqual(await resultPromise, { code: 0, signal: null });
    assert.equal(childEnv[MAINTENANCE_BYPASS_ENV], lock.bypassToken);
  } finally {
    await lock.release();
    await rm(updateLockPath(cwd), { force: true }).catch(() => {});
    await rm(cwd, { recursive: true, force: true });
  }
});
