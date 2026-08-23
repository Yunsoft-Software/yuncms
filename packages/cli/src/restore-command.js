import { resolve } from 'node:path';

import { loadConfig } from '@yunsoft/yuncms-core';

import { parseCommandOptions } from './command-options.js';
import { acquireDatabaseMaintenanceLock } from './maintenance-lock.js';
import { restoreProjectBackup } from './project-backup.js';
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

export async function runRestoreCommand({
  args = [],
  cwd = process.cwd(),
  env = process.env,
  output = console,
  restoreBackup = restoreProjectBackup,
  acquireLock = acquireUpdateLock,
  acquireMaintenanceLock = acquireDatabaseMaintenanceLock,
  assertStopped = assertYunCmsStopped,
  fetchFn = globalThis.fetch,
} = {}) {
  const { values, positionals } = parseCommandOptions(args, {
    boolean: ['--yes', '--allow-different-database-target'],
    minPositionals: 1,
    maxPositionals: 1,
  });

  if (!values['--yes']) {
    const error = new Error('Restore is destructive and requires --yes');
    error.code = 'RESTORE_CONFIRMATION_REQUIRED';
    throw error;
  }

  const config = loadConfig(env);
  const assertServiceStopped = () => assertStopped({
    host: config.server.host,
    port: config.server.port,
    fetchFn,
  });

  const lock = await acquireLock({ cwd });
  let maintenanceLock = null;
  try {
    await assertServiceStopped();
    maintenanceLock = assertLockContract(await acquireMaintenanceLock({ env }));
    await assertServiceStopped();
    await maintenanceLock.assertHeld();

    const beforeDestructive = async () => {
      await assertServiceStopped();
      await maintenanceLock.assertHeld();
    };

    const restored = await restoreBackup({
      backupPath: resolve(cwd, positionals[0]),
      cwd,
      env,
      output,
      allowDifferentDatabaseTarget: values['--allow-different-database-target'] === true,
      beforeDestructive,
    });
    if (restored?.manifest?.project?.packageLock) {
      output.warn?.('Project package files were restored. Run npm ci before starting YunCMS so node_modules matches the restored lockfile.');
    } else if (restored?.manifest?.project?.packageJson) {
      output.warn?.('Project package.json was restored. Run npm install before starting YunCMS so node_modules matches the restored project.');
    }
    return restored;
  } finally {
    if (maintenanceLock) await maintenanceLock.release();
    await lock.release();
  }
}
