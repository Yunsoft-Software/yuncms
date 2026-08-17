import { readdirSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const ROOT = resolve(import.meta.dirname, '..');
const MODE = process.argv[2] || 'full';
const NPM = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const MAX_BUFFER = 16 * 1024 * 1024;
const TEST_ROOTS = [
  'packages/core/test',
  'packages/api/test',
  'packages/cli/test',
  'packages/extensions-sdk/test',
  'apps/studio/test',
];

const FAST_TESTS = [
  'packages/core/test/core.test.js',
  'packages/core/test/bootstrap.test.js',
  'packages/core/test/production-config.test.js',
  'packages/core/test/schema-query.test.js',
  'packages/core/test/schema-access.test.js',
  'packages/core/test/collection-visibility.test.js',
  'packages/core/test/public-access.test.js',
  'packages/core/test/items-service.test.js',
  'packages/core/test/permissions-service.test.js',
  'packages/core/test/relation-expansion.test.js',
  'packages/api/test/authentication.test.js',
  'packages/api/test/error-response.test.js',
  'packages/api/test/request-identity.test.js',
  'packages/api/test/production-app-config.test.js',
  'packages/api/test/rate-limit.test.js',
  'packages/api/test/security-headers.test.js',
  'packages/api/test/studio.test.js',
  'packages/cli/test/cli.test.js',
  'packages/extensions-sdk/test/sdk.test.js',
  'apps/studio/test/collection-visibility.test.js',
];

function collectTests(path) {
  const absolute = resolve(ROOT, path);
  if (!statSync(absolute).isDirectory()) return [path];
  return readdirSync(absolute, { withFileTypes: true })
    .flatMap((entry) => {
      const child = `${path}/${entry.name}`;
      if (entry.isDirectory()) return collectTests(child);
      return entry.isFile() && entry.name.endsWith('.test.js') ? [child] : [];
    });
}

function commandLabel(command, args) {
  return [command, ...args].join(' ');
}

function spawn(command, args, env) {
  return spawnSync(command, args, {
    cwd: ROOT,
    env,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    maxBuffer: MAX_BUFFER,
  });
}

function run(command, args, { label, env = process.env, failureArgs = null } = {}) {
  const started = Date.now();
  const result = spawn(command, args, env);
  const elapsed = ((Date.now() - started) / 1000).toFixed(1);

  if (result.status === 0) {
    console.log(`✓ ${label || commandLabel(command, args)} (${elapsed}s)`);
    return;
  }

  console.error(`✗ ${label || commandLabel(command, args)} (${elapsed}s)`);
  const rerun = failureArgs ? spawn(command, failureArgs, env) : result;
  const output = [rerun.stdout, rerun.stderr].filter(Boolean).join('\n').trim();
  if (output) console.error(output);
  process.exit(result.status || 1);
}

function runNodeTests(files, label) {
  run(
    process.execPath,
    ['--test', '--test-reporter=dot', ...files],
    {
      label,
      failureArgs: ['--test', '--test-reporter=spec', ...files],
    },
  );
}

function assertRuntime() {
  const major = Number(process.versions.node.split('.')[0]);
  if (major !== 24) {
    console.error(`✗ Node 24 LTS required; current runtime is ${process.version}`);
    process.exit(1);
  }
}

function runPackChecks() {
  const workspaces = [
    '@yunsoft/yuncms-core',
    '@yunsoft/yuncms-api',
    '@yunsoft/yuncms',
    '@yunsoft/yuncms-extensions-sdk',
  ];
  for (const workspace of workspaces) {
    run(NPM, ['pack', '--dry-run', '--json', `--workspace=${workspace}`], {
      label: `package contract ${workspace}`,
    });
  }
}

assertRuntime();

if (!['fast', 'full', 'release'].includes(MODE)) {
  console.error('Usage: node scripts/verify.mjs [fast|full|release]');
  process.exit(2);
}

if (MODE === 'fast') {
  runNodeTests(FAST_TESTS, `fast regression suite (${FAST_TESTS.length} files)`);
  process.exit(0);
}

const allTests = TEST_ROOTS.flatMap(collectTests).sort();
runNodeTests(allTests, `complete source suite (${allTests.length} files)`);

if (MODE === 'release') {
  run(NPM, ['run', 'build:studio'], { label: 'Studio production build' });
  runPackChecks();

  if (process.env.YUNCMS_TEST_MYSQL === '1') {
    run(process.execPath, ['--test', '--test-reporter=dot', 'test/integration'], {
      label: 'real MySQL/API integration suite',
      failureArgs: ['--test', '--test-reporter=spec', 'test/integration'],
    });
  } else {
    console.log('○ real MySQL/API integration skipped (set YUNCMS_TEST_MYSQL=1)');
  }
}
