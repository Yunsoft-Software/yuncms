import { resolve } from 'node:path';

import { loadConfig } from '@yunsoft/yuncms-core';

import { parseCommandOptions } from './command-options.js';
import { createProjectBackup } from './project-backup.js';
import { assertYunCmsStopped } from './service-state.js';

export async function runBackupCommand({
  args = [],
  cwd = process.cwd(),
  env = process.env,
  output = console,
  createBackup = createProjectBackup,
  assertStopped = assertYunCmsStopped,
  fetchFn = globalThis.fetch,
} = {}) {
  const { values } = parseCommandOptions(args, {
    string: ['--output'],
    maxPositionals: 0,
  });

  const config = loadConfig(env);
  await assertStopped({ host: config.server.host, port: config.server.port, fetchFn });

  const backupPath = values['--output'] ? resolve(cwd, values['--output']) : null;
  return createBackup({ cwd, env, output, backupPath });
}
