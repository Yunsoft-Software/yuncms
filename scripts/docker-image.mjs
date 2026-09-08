import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const DEFAULT_IMAGE = 'yunsoftofficial/yuncms';
const DEFAULT_PLATFORMS = 'linux/amd64,linux/arm64';
const IMAGE_PATTERN = /^(?:[a-z0-9]+(?:[._-][a-z0-9]+)*\/)*[a-z0-9]+(?:[._-][a-z0-9]+)*$/;

function workspaceVersion() {
  return JSON.parse(readFileSync(resolve(ROOT, 'package.json'), 'utf8')).version;
}

function gitRevision() {
  return execFileSync('git', ['rev-parse', '--short=12', 'HEAD'], {
    cwd: ROOT,
    encoding: 'utf8',
  }).trim();
}

export function resolveImageName(env = process.env) {
  const image = String(env.YUNCMS_DOCKER_IMAGE || DEFAULT_IMAGE).trim();
  if (!IMAGE_PATTERN.test(image)) {
    throw new Error(`YUNCMS_DOCKER_IMAGE must be an untagged lowercase image name, received: ${image}`);
  }
  return image;
}

export function createDockerBuildArguments({
  env = process.env,
  push = false,
  load = false,
  version = workspaceVersion(),
  revision = gitRevision(),
  buildDate = new Date().toISOString(),
} = {}) {
  if (push && load) throw new Error('--push and --load cannot be used together');

  const image = resolveImageName(env);
  const args = [
    'buildx',
    'build',
    '--build-arg',
    `BUILD_DATE=${buildDate}`,
    '--build-arg',
    `VERSION=${version}`,
    '--build-arg',
    `VCS_REF=${revision}`,
    '--tag',
    `${image}:${version}`,
    '--tag',
    `${image}:latest`,
  ];

  if (push) {
    args.push(
      '--platform',
      env.YUNCMS_DOCKER_PLATFORMS || DEFAULT_PLATFORMS,
      '--provenance=true',
      '--sbom=true',
      '--push',
    );
  } else if (load) {
    args.push('--load');
  }

  args.push(ROOT);
  return Object.freeze({ image, version, args: Object.freeze(args) });
}

function parseArguments(argv) {
  const allowed = new Set(['--dry-run', '--load', '--push']);
  for (const argument of argv) {
    if (!allowed.has(argument)) throw new Error(`Unknown argument: ${argument}`);
  }
  return {
    dryRun: argv.includes('--dry-run'),
    load: argv.includes('--load'),
    push: argv.includes('--push'),
  };
}

export function runDockerImageCommand({ argv = process.argv.slice(2), env = process.env } = {}) {
  const options = parseArguments(argv);
  const build = createDockerBuildArguments({ env, push: options.push, load: options.load });

  if (options.dryRun) {
    process.stdout.write(`${JSON.stringify({ command: 'docker', ...build }, null, 2)}\n`);
    return;
  }

  const result = spawnSync('docker', build.args, { cwd: ROOT, env, stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exitCode = result.status || 1;
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : null;
if (invokedPath === fileURLToPath(import.meta.url)) {
  try {
    runDockerImageCommand();
  } catch (error) {
    console.error(`YunCMS Docker build failed: ${error.message}`);
    process.exitCode = 1;
  }
}
