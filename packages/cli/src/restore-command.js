import { resolve } from 'node:path';

import { parseCommandOptions } from './command-options.js';
import { restoreProjectBackup } from './project-backup.js';
import { acquireUpdateLock } from './update-lock.js';

export async function runRestoreCommand({
  args = [],
  cwd = process.cwd(),
  env = process.env,
  output = console,
  restoreBackup = restoreProjectBackup,
  acquireLock = acquireUpdateLock,
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

  const lock = await acquireLock({ cwd });
  try {
    return await restoreBackup({
      backupPath: resolve(cwd, positionals[0]),
      cwd,
      env,
      output,
      allowDifferentDatabaseTarget: values['--allow-different-database-target'] === true,
    });
  } finally {
    await lock.release();
  }
}
