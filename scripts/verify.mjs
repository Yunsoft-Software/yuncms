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
  'packages/core/test/maintenance-state.test.js',
  'packages/core/test/production-config.test.js',
  'packages/core/test/schema-query.test.js',
  'packages/core/test/schema-access.test.js',
  'packages/core/test/schema-key.test.js',
  'packages/core/test/schema-metadata-interface.test.js',
  'packages/core/test/collection-visibility.test.js',
  'packages/core/test/system-fields.test.js',
  'packages/core/test/system-collection-fields.test.js',
  'packages/core/test/timestamp-fields.test.js',
  'packages/core/test/public-access.test.js',
  'packages/core/test/system-permissions.test.js',
  'packages/core/test/system-users-access.test.js',
  'packages/core/test/system-files-access.test.js',
  'packages/core/test/system-roles-access.test.js',
  'packages/core/test/studio-settings-service.test.js',
  'packages/core/test/auth.test.js',
  'packages/core/test/o2o-relation.test.js',
  'packages/core/test/items-service.test.js',
  'packages/core/test/items-system-fields.test.js',
  'packages/core/test/permissions-service.test.js',
  'packages/core/test/relation-expansion.test.js',

  'packages/api/test/authentication.test.js',
  'packages/api/test/error-response.test.js',
  'packages/api/test/maintenance-startup.test.js',
  'packages/api/test/request-identity.test.js',
  'packages/api/test/schema-cache.test.js',
  'packages/api/test/schema-o2o.test.js',
  'packages/api/test/system-schema-route.test.js',
  'packages/api/test/production-app-config.test.js',
  'packages/api/test/rate-limit.test.js',
  'packages/api/test/security-headers.test.js',
  'packages/api/test/studio-settings.test.js',
  'packages/api/test/studio.test.js',

  'packages/cli/test/backup-integrity.test.js',
  'packages/cli/test/cli.test.js',
  'packages/cli/test/database-backup-options.test.js',
  'packages/cli/test/database-backup-process.test.js',
  'packages/cli/test/default-port.test.js',
  'packages/cli/test/maintenance-lock.test.js',
  'packages/cli/test/process-runner.test.js',
  'packages/cli/test/restore-command.test.js',
  'packages/cli/test/restore-validation.test.js',
  'packages/cli/test/runtime-probe-maintenance.test.js',
  'packages/cli/test/service-state.test.js',
  'packages/cli/test/update-dependency-section.test.js',
  'packages/cli/test/update-lock.test.js',
  'packages/cli/test/update-preflight.test.js',
  'packages/cli/test/update-same-version.test.js',
  'packages/cli/test/upgrade.test.js',

  'packages/extensions-sdk/test/sdk.test.js',

  'apps/studio/test/collection-visibility.test.js',
  'apps/studio/test/collection-ui.test.js',
  'apps/studio/test/schema-name.test.js',
  'apps/studio/test/studio-settings.test.js',
  'apps/studio/test/appearance-logo-picker.test.js',
  'apps/studio/test/localization.test.js',
  'apps/studio/test/field-ui.test.js',
  'apps/studio/test/field-builder-ui.test.js',
  'apps/studio/test/data-model-v2.test.js',
  'apps/studio/test/content-display-names.test.js',
  'apps/studio/test/file-field-preview.test.js',
  'apps/studio/test/files-preview-ui.test.js',
  'apps/studio/test/sidebar-ui.test.js',
  'apps/studio/test/dark-mode.test.js',
  'apps/studio/test/roles-permissions-ui.test.js',
  'apps/studio/test/permission-resource-ui.test.js',
  'apps/studio/test/users-access-ui.test.js',
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
    const integrationTests = collectTests('test/integration').sort();
    runNodeTests(integrationTests, `real MySQL/API integration suite (${integrationTests.length} files)`);
  } else {
    console.log('○ real MySQL/API integration skipped (set YUNCMS_TEST_MYSQL=1)');
  }
}
