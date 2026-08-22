import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';

import {
  assertMaintenanceStartupAllowed,
  hashMaintenanceBypassToken,
  MAINTENANCE_BYPASS_ENV,
  maintenanceLockPath,
} from '../src/maintenance-state.js';

async function writeLock(cwd, state) {
  const path = maintenanceLockPath(cwd);
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  await writeFile(path, `${JSON.stringify(state)}\n`, { mode: 0o600 });
  return path;
}

test('maintenance lock path is deterministic per project and outside the project tree', async () => {
  const cwd = await mkdtemp(join(tmpdir(), 'yuncms-maintenance-project-'));
  try {
    const path = maintenanceLockPath(cwd);
    assert.equal(path.startsWith(cwd), false);
    assert.equal(maintenanceLockPath(cwd), path);
  } finally {
    await rm(maintenanceLockPath(cwd), { force: true }).catch(() => {});
    await rm(cwd, { recursive: true, force: true });
  }
});

test('symlink aliases for the same physical project share one maintenance lock identity', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'yuncms-maintenance-alias-'));
  const project = join(root, 'project');
  const alias = join(root, 'alias');
  await mkdir(project);
  try {
    try {
      await symlink(project, alias, 'dir');
    } catch (error) {
      if (error?.code === 'EPERM' || error?.code === 'EACCES') {
        t.skip(`directory symlink unavailable: ${error.code}`);
        return;
      }
      throw error;
    }
    assert.equal(maintenanceLockPath(project), maintenanceLockPath(alias));
  } finally {
    await rm(maintenanceLockPath(project), { force: true }).catch(() => {});
    await rm(root, { recursive: true, force: true });
  }
});

test('startup is allowed when no maintenance operation is active', async () => {
  const cwd = await mkdtemp(join(tmpdir(), 'yuncms-maintenance-none-'));
  try {
    await assert.doesNotReject(assertMaintenanceStartupAllowed({ cwd, env: {} }));
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test('maintenance state blocks normal startup but permits only the matching bypass token', async () => {
  const cwd = await mkdtemp(join(tmpdir(), 'yuncms-maintenance-token-'));
  const token = 'a'.repeat(64);
  const path = await writeLock(cwd, {
    pid: 123,
    startedAt: '2026-08-22T10:00:00.000Z',
    cwd,
    bypassTokenHash: hashMaintenanceBypassToken(token),
  });

  try {
    await assert.rejects(
      assertMaintenanceStartupAllowed({ cwd, env: {} }),
      (error) => error.code === 'YUNCMS_MAINTENANCE_ACTIVE'
        && error.lockPath === path
        && error.pid === 123,
    );
    await assert.rejects(
      assertMaintenanceStartupAllowed({
        cwd,
        env: { [MAINTENANCE_BYPASS_ENV]: 'b'.repeat(64) },
      }),
      (error) => error.code === 'YUNCMS_MAINTENANCE_ACTIVE',
    );
    await assert.doesNotReject(
      assertMaintenanceStartupAllowed({
        cwd,
        env: { [MAINTENANCE_BYPASS_ENV]: token },
      }),
    );
  } finally {
    await rm(path, { force: true });
    await rm(cwd, { recursive: true, force: true });
  }
});

test('malformed or legacy maintenance lock fails closed instead of allowing startup', async () => {
  const cwd = await mkdtemp(join(tmpdir(), 'yuncms-maintenance-invalid-'));
  const path = maintenanceLockPath(cwd);
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  try {
    await writeFile(path, '{not-json', { mode: 0o600 });
    await assert.rejects(
      assertMaintenanceStartupAllowed({ cwd, env: {} }),
      (error) => error.code === 'YUNCMS_MAINTENANCE_ACTIVE',
    );

    await writeFile(path, `${JSON.stringify({ pid: 1, startedAt: '2026-08-22T10:00:00.000Z' })}\n`);
    await assert.rejects(
      assertMaintenanceStartupAllowed({
        cwd,
        env: { [MAINTENANCE_BYPASS_ENV]: 'a'.repeat(64) },
      }),
      (error) => error.code === 'YUNCMS_MAINTENANCE_ACTIVE',
    );
  } finally {
    await rm(path, { force: true });
    await rm(cwd, { recursive: true, force: true });
  }
});
