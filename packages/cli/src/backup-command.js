import { rm } from 'node:fs/promises';
import { resolve } from 'node:path';

import { loadConfig } from '@yunsoft/yuncms-core';

import { parseCommandOptions } from './command-options.js';
import { acquireDatabaseMaintenanceLock } from './maintenance-lock.js';
import { createProjectBackup } from './project-backup.js';
import { assertYunCmsStopped } from './service-state.js';
import { acquireUpdateLock } from './update-lock.js';

function assertLockContract(lock) {
  if (!lock || typeof lock.assertHeld !== 'function' || typeof lock.release !== 'function') {
    const error = new Error('Database maintenance lock implementation is invalid');
    error.code = 'DATABASE_MAINTENANCE_LOCK_INVALID';
    throw error;
  }
  return lock;
}

export async function runBackupCommand({
  args = [],
  cwd = process.cwd(),
  env = process.env,
  output = console,
  createBackup = createProjectBackup,
  assertStopped = assertYunCmsStopped,
  acquireProjectLock = acquireUpdateLock,
  acquireMaintenanceLock = acquireDatabaseMaintenanceLock,
  fetchFn = globalThis.fetch,
} = {}) {
  const { values } = parseCommandOptions(args, {
    string: ['--output'],
    maxPositionals: 0,
  });

  const config = loadConfig(env);
  const assertServiceStopped = () => assertStopped({
    host: config.server.host,
    port: config.server.port,
    fetchFn,
  });
  await assertServiceStopped();

  const projectLock = await acquireProjectLock({ cwd });
  let maintenanceLock = null;
  let backup = null;
  try {
    maintenanceLock = assertLockContract(await acquireMaintenanceLock({ env }));
    await assertServiceStopped();
    await maintenanceLock.assertHeld();

    const backupPath = values['--output'] ? resolve(cwd, values['--output']) : null;
    backup = await createBackup({ cwd, env, output, backupPath });

    try {
      await assertServiceStopped();
      await maintenanceLock.assertHeld();
    } catch (error) {
      if (backup?.backupPath) {
        await rm(backup.backupPath, { recursive: true, force: true }).catch(() => {});
        error.backupDiscarded = true;
      }
      throw error;
    }

    return backup;
  } finally {
    if (maintenanceLock) await maintenanceLock.release();
    await projectLock.release();
  }
}
