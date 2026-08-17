import { runBootstrapCommand } from './bootstrap-command.js';
import { runInitCommand } from './init-command.js';
import { runStartCommand } from './start-command.js';

function assertSupportedNode(version = process.versions.node) {
  const major = Number(String(version).split('.')[0]);
  if (major !== 24) {
    const error = new Error(`YunCMS requires Node.js 24 LTS; current runtime is ${version}`);
    error.code = 'UNSUPPORTED_NODE_VERSION';
    throw error;
  }
}

function printHelp(output) {
  output.log?.(`YunCMS CLI\n\nCommands:\n  yuncms init        Configure MySQL, bootstrap schema and create the first administrator\n  yuncms bootstrap   Apply required core database migrations\n  yuncms start       Start the YunCMS API using the current project environment\n  yuncms help        Show this help`);
}

export async function runCli(argv = process.argv.slice(2), {
  output = console,
  env = process.env,
  cwd = process.cwd(),
  prompts,
  startCommand = runStartCommand,
} = {}) {
  assertSupportedNode();
  const [command = 'help', ...rest] = argv;

  if (rest.length > 0) {
    const error = new Error(`Unexpected arguments for ${command}: ${rest.join(' ')}`);
    error.code = 'INVALID_CLI_ARGUMENTS';
    throw error;
  }

  switch (command) {
    case 'init':
      return runInitCommand({ env, cwd, output, ...(prompts ? { prompts } : {}) });
    case 'bootstrap':
      return runBootstrapCommand({ env, output });
    case 'start':
      return startCommand({ env, cwd, output });
    case 'help':
    case '--help':
    case '-h':
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
