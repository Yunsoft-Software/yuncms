import { randomBytes } from 'node:crypto';
import { mkdir, open, rm } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

import {
  hashMaintenanceBypassToken,
  maintenanceLockPath,
} from '@yunsoft/yuncms-core';

export function updateLockPath(cwd = process.cwd()) {
  return maintenanceLockPath(cwd);
}

export async function acquireUpdateLock({
  cwd = process.cwd(),
  now = new Date(),
  pid = process.pid,
  generateToken = () => randomBytes(32).toString('hex'),
} = {}) {
  const path = updateLockPath(cwd);
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });

  let handle;
  try {
    handle = await open(path, 'wx', 0o600);
  } catch (error) {
    if (error?.code === 'EEXIST') {
      const locked = new Error(
        `Another YunCMS backup/update/restore operation may already be running. Inspect and remove the stale lock only after verifying no operation is active: ${path}`,
      );
      locked.code = 'UPDATE_ALREADY_RUNNING';
      locked.lockPath = path;
      throw locked;
    }
    throw error;
  }

  let bypassToken;
  try {
    bypassToken = generateToken();
    const bypassTokenHash = hashMaintenanceBypassToken(bypassToken);
    await handle.writeFile(
      `${JSON.stringify({
        pid,
        startedAt: now.toISOString(),
        cwd: resolve(cwd),
        bypassTokenHash,
      }, null, 2)}\n`,
      'utf8',
    );
  } catch (error) {
    await handle.close().catch(() => {});
    await rm(path, { force: true }).catch(() => {});
    throw error;
  }

  let released = false;
  return {
    path,
    bypassToken,
    async release() {
      if (released) return;
      released = true;
      await handle.close().catch(() => {});
      await rm(path, { force: true });
    },
  };
}
