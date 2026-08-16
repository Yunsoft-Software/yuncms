import { runBootstrapCommand } from './bootstrap-command.js';

function assertSupportedNode(version = process.versions.node) {
  const major = Number(String(version).split('.')[0]);
  if (major !== 24) {
    const error = new Error(`YunCMS requires Node.js 24 LTS; current runtime is ${version}`);
    error.code = 'UNSUPPORTED_NODE_VERSION';
    throw error;
  }
}

function printHelp(output) {
  output.log?.(`YunCMS CLI\n\nCommands:\n  yuncms bootstrap   Apply required core database migrations\n  yuncms help        Show this help\n\nThe interactive init wizard and start wrapper are planned but not shipped yet.`);
}

export async function runCli(argv = process.argv.slice(2), { output = console, env = process.env } = {}) {
  assertSupportedNode();
  const [command = 'help', ...rest] = argv;

  if (rest.length > 0) {
    const error = new Error(`Unexpected arguments for ${command}: ${rest.join(' ')}`);
    error.code = 'INVALID_CLI_ARGUMENTS';
    throw error;
  }

  switch (command) {
    case 'bootstrap':
      return runBootstrapCommand({ env, output });
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
