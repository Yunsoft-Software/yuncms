import { randomBytes } from 'node:crypto';
import { lstat, mkdir, open, readFile, rm } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

import {
  assertSecureUserParentDir,
  hashMaintenanceBypassToken,
  legacyMaintenanceLockPath,
  maintenanceLockPath,
  probeLegacyMaintenanceLock,
} from '@yunsoft/yuncms-core';

export function updateLockPath(cwd = process.cwd(), options = {}) {
  return maintenanceLockPath(cwd, options);
}

export function legacyUpdateLockPath(cwd = process.cwd(), options = {}) {
  return legacyMaintenanceLockPath(cwd, options);
}

export async function acquireUpdateLock({
  cwd = process.cwd(),
  now = new Date(),
  pid = process.pid,
  generateToken = () => randomBytes(32).toString('hex'),
  tempRoot,
  getuidFn,
  userInfoFn,
  readFileFn = readFile,
  lstatFn = lstat,
} = {}) {
  const options = {
    cwd,
    tempRoot,
    getuidFn,
    userInfoFn,
    readFileFn,
    lstatFn,
  };

  // 1. An accessible active or corrupt legacy lock blocks new CLI acquisition
  let legacy;
  try {
    legacy = await probeLegacyMaintenanceLock(options);
  } catch (err) {
    if (err?.code === 'YUNCMS_MAINTENANCE_ACTIVE') {
      const locked = new Error(
        `Another YunCMS backup/update/restore operation may already be running. Inspect and remove the stale lock only after verifying no operation is active: ${err.lockPath || legacyMaintenanceLockPath(cwd, options)}`,
      );
      locked.code = 'UPDATE_ALREADY_RUNNING';
      locked.lockPath = err.lockPath || legacyMaintenanceLockPath(cwd, options);
      locked.cause = err;
      throw locked;
    }
    throw err;
  }

  if (legacy) {
    const locked = new Error(
      `Another YunCMS backup/update/restore operation may already be running. Inspect and remove the stale lock only after verifying no operation is active: ${legacy.path}`,
    );
    locked.code = 'UPDATE_ALREADY_RUNNING';
    locked.lockPath = legacy.path;
    throw locked;
  }

  // 2. Prepare per-user lock directory and validate security
  const path = updateLockPath(cwd, options);
  const parentDir = dirname(path);
  await mkdir(parentDir, { recursive: true, mode: 0o700 });
  await assertSecureUserParentDir(parentDir, { lstatFn, getuidFn });

  // 3. Acquire exclusive lock file
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
