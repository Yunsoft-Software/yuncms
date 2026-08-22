import { resolve } from 'node:path';

import { parseCommandOptions } from './command-options.js';
import { createProjectBackup } from './project-backup.js';

export async function runBackupCommand({
  args = [],
  cwd = process.cwd(),
  env = process.env,
  output = console,
  createBackup = createProjectBackup,
} = {}) {
  const { values } = parseCommandOptions(args, {
    string: ['--output'],
    maxPositionals: 0,
  });

  const backupPath = values['--output'] ? resolve(cwd, values['--output']) : null;
  return createBackup({ cwd, env, output, backupPath });
}
