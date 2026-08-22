import { resolve } from 'node:path';

import { loadConfig } from '@yunsoft/yuncms-core';

import { parseCommandOptions } from './command-options.js';
import { acquireDatabaseMaintenanceLock } from './maintenance-lock.js';
import { createProjectBackup } from './project-backup.js';
import { assertYunCmsStopped } from './service-state.js';
import { acquireUpdateLock } from './update-lock.js';

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
  try {
    maintenanceLock = await acquireMaintenanceLock({ env });
    await assertServiceStopped();

    const backupPath = values['--output'] ? resolve(cwd, values['--output']) : null;
    return await createBackup({ cwd, env, output, backupPath });
  } finally {
    if (maintenanceLock) await maintenanceLock.release();
    await projectLock.release();
  }
}
