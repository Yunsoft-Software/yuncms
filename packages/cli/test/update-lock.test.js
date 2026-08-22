import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { acquireUpdateLock, updateLockPath } from '../src/update-lock.js';

test('update lock is stable per project and lives outside the project tree', async () => {
  const cwd = await mkdtemp(join(tmpdir(), 'yuncms-lock-project-'));
  try {
    const path = updateLockPath(cwd);
    assert.equal(path.startsWith(cwd), false);
    assert.equal(updateLockPath(cwd), path);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test('second destructive operation fails while project lock is held and succeeds after release', async () => {
  const cwd = await mkdtemp(join(tmpdir(), 'yuncms-lock-project-'));
  try {
    const first = await acquireUpdateLock({
      cwd,
      now: new Date('2026-08-22T09:00:00.000Z'),
      pid: 123,
    });

    await assert.rejects(
      acquireUpdateLock({ cwd, pid: 456 }),
      (error) => error.code === 'UPDATE_ALREADY_RUNNING' && error.lockPath === first.path,
    );

    await first.release();
    const second = await acquireUpdateLock({ cwd, pid: 456 });
    await second.release();
  } finally {
    await rm(updateLockPath(cwd), { force: true }).catch(() => {});
    await rm(cwd, { recursive: true, force: true });
  }
});
