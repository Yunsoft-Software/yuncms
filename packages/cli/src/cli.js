import { runBackupCommand } from './backup-command.js';
import { runBootstrapCommand } from './bootstrap-command.js';
import { runInitCommand } from './init-command.js';
import { runRestoreCommand } from './restore-command.js';
import { runStartCommand } from './start-command.js';
import { runUpdateCommand } from './update-command.js';

function assertSupportedNode(version = process.versions.node) {
  const major = Number(String(version).split('.')[0]);
  if (major !== 24) {
    const error = new Error(`YunCMS requires Node.js 24 LTS; current runtime is ${version}`);
    error.code = 'UNSUPPORTED_NODE_VERSION';
    throw error;
  }
}

function assertNoArguments(command, rest) {
  if (rest.length === 0) return;
  const error = new Error(`Unexpected arguments for ${command}: ${rest.join(' ')}`);
  error.code = 'INVALID_CLI_ARGUMENTS';
  throw error;
}

function printHelp(output) {
  output.log?.(`YunCMS CLI\n\nCommands:\n  yuncms init                         Configure MySQL, bootstrap schema and create the first administrator\n  yuncms bootstrap                    Apply required core database migrations\n  yuncms start                        Start the YunCMS API using the current project environment\n  yuncms backup [--output PATH]       Create a database/project backup\n  yuncms restore PATH --yes           Restore an exact backup snapshot\n  yuncms update [--to VERSION]        Backup, update package, migrate, probe and rollback on failure\n  yuncms update --dry-run             Inspect update safety without changing the project\n  yuncms help                         Show this help`);
}

export async function runCli(argv = process.argv.slice(2), {
  output = console,
  env = process.env,
  cwd = process.cwd(),
  prompts,
  startCommand = runStartCommand,
  backupCommand = runBackupCommand,
  restoreCommand = runRestoreCommand,
  updateCommand = runUpdateCommand,
} = {}) {
  assertSupportedNode();
  const [command = 'help', ...rest] = argv;

  switch (command) {
    case 'init':
      assertNoArguments(command, rest);
      return runInitCommand({ env, cwd, output, ...(prompts ? { prompts } : {}) });
    case 'bootstrap':
      assertNoArguments(command, rest);
      return runBootstrapCommand({ env, output });
    case 'start':
      assertNoArguments(command, rest);
      return startCommand({ env, cwd, output });
    case 'backup':
      return backupCommand({ args: rest, env, cwd, output });
    case 'restore':
      return restoreCommand({ args: rest, env, cwd, output });
    case 'update':
      return updateCommand({ args: rest, env, cwd, output });
    case 'help':
    case '--help':
    case '-h':
      assertNoArguments(command, rest);
      printHelp(output);
      return null;
    default: {
      const error = new Error(`Unknown YunCMS command: ${command}`);
      error.code = 'UNKNOWN_CLI_COMMAND';
      throw error;
    }
  }
}

export { assertSupportedNode };
