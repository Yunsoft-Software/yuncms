import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';

const ENABLED = process.env.YUNCMS_TEST_DOCKER === '1';

test('Docker container backup and restore round trip preserves generated columns, roles and files', {
  skip: !ENABLED,
  timeout: 180_000,
}, async () => {
  const imageName = process.env.YUNCMS_TEST_DOCKER_IMAGE;
  if (!imageName || typeof imageName !== 'string' || imageName.trim().length === 0) {
    throw new Error('YUNCMS_TEST_DOCKER_IMAGE is required when YUNCMS_TEST_DOCKER=1 (pass prebuilt image tag)');
  }

  const rootDir = resolve(import.meta.dirname, '../..');
  const workspacePackage = JSON.parse(readFileSync(resolve(rootDir, 'package.json'), 'utf8'));
  const expectedVersion = workspacePackage.version;
  const expectedRevision = execFileSync('git', ['rev-parse', '--short=12', 'HEAD'], {
    cwd: rootDir,
    encoding: 'utf8',
  }).trim();

  // 1. Assert externally passed image metadata, version, and architecture contracts
  const inspectOutput = execFileSync('docker', ['image', 'inspect', imageName], {
    encoding: 'utf8',
    timeout: 60_000,
  });
  const [inspect] = JSON.parse(inspectOutput);
  assert.ok(inspect, `Docker image not found: ${imageName}`);
  assert.match(inspect.Id, /^sha256:[0-9a-f]{64}$/i, 'Docker image ID must be a valid sha256 hash');

  const architecture = inspect.Architecture;
  assert.ok(architecture, `Docker image missing Architecture: ${imageName}`);
  const targetPlatform = `linux/${architecture}`;

  const config = inspect.Config ?? {};
  const user = config.User ?? '';
  assert.ok(user === 'node' || user === '1000', `Docker image must run as non-root user 'node', got: ${user}`);

  const labels = config.Labels ?? {};
  assert.equal(labels['org.opencontainers.image.title'], 'YunCMS', 'Image title label must be YunCMS');
  assert.equal(labels['org.opencontainers.image.version'], expectedVersion, `Image version must match workspace package.json (${expectedVersion})`);
  assert.equal(labels['org.opencontainers.image.revision'], expectedRevision, `Image revision label must match git HEAD 12-char prefix (${expectedRevision})`);

  // Credentials and names for dedicated disposable resources
  const suffix = randomBytes(4).toString('hex');
  const networkName = `yuncms_test_net_${suffix}`;
  const mysqlContainer = `yuncms_test_mysql_${suffix}`;
  const mysqlVolume = `yuncms_test_db_${suffix}`;
  const dataVolume = `yuncms_test_data_${suffix}`;
  const dbName = 'yuncms_test_docker_restore';
  const rootPassword = `Root_${randomBytes(8).toString('hex')}!`;
  const appPassword = `App_${randomBytes(8).toString('hex')}!`;
  const secretTokens = [rootPassword, appPassword];

  function redactSecrets(text) {
    if (!text || typeof text !== 'string') return '';
    let sanitized = text;
    for (const secret of secretTokens) {
      if (secret) sanitized = sanitized.replaceAll(secret, '[REDACTED_PASSWORD]');
    }
    return sanitized;
  }

  function runDocker(args, { timeoutMs = 60_000, stdio = 'pipe' } = {}) {
    try {
      return execFileSync('docker', args, {
        timeout: timeoutMs,
        encoding: 'utf8',
        stdio: ['ignore', stdio === 'ignore' ? 'ignore' : 'pipe', 'pipe'],
      });
    } catch (error) {
      const status = error.status ?? error.code ?? 'unknown';
      const stderr = redactSecrets(error.stderr ?? error.message ?? '');
      const stdout = redactSecrets(error.stdout ?? '');
      const sanitized = new Error(
        `Docker command '${args[0]}' failed with status ${status}${stderr ? `: ${stderr.trim()}` : ''}`,
      );
      sanitized.status = error.status;
      sanitized.code = error.code;
      sanitized.stdout = stdout;
      sanitized.stderr = stderr;
      throw sanitized;
    }
  }

  // 2. Assert Node 24 runtime, non-root user, and native MySQL client in candidate image
  const nodeVersion = runDocker(['run', '--rm', '--platform', targetPlatform, '--entrypoint', 'node', imageName, '-v']).trim();
  assert.match(nodeVersion, /^v24\./, `Container Node version must be 24 LTS, got: ${nodeVersion}`);

  const uid = runDocker(['run', '--rm', '--platform', targetPlatform, '--entrypoint', 'id', imageName, '-u']).trim();
  assert.notEqual(uid, '0', `Container must not execute as root (UID 0), got: ${uid}`);

  const mysqlVersion = runDocker(['run', '--rm', '--platform', targetPlatform, '--entrypoint', 'mysql', imageName, '--version']).trim();
  assert.match(mysqlVersion, /MySQL/i, `Container mysql client must identify as MySQL, got: ${mysqlVersion}`);
  assert.doesNotMatch(mysqlVersion, /MariaDB/i, `Container mysql client must not identify as MariaDB, got: ${mysqlVersion}`);

  const mysqldumpVersion = runDocker(['run', '--rm', '--platform', targetPlatform, '--entrypoint', 'mysqldump', imageName, '--version']).trim();
  assert.match(mysqldumpVersion, /MySQL/i, `Container mysqldump client must identify as MySQL, got: ${mysqldumpVersion}`);
  assert.doesNotMatch(mysqldumpVersion, /MariaDB/i, `Container mysqldump client must not identify as MariaDB, got: ${mysqldumpVersion}`);

  // 3. Track and provision isolated Docker resources
  const created = {
    network: false,
    mysqlVolume: false,
    dataVolume: false,
    mysqlContainer: false,
  };

  const cleanupErrors = [];
  try {
    runDocker(['network', 'create', networkName]);
    created.network = true;

    runDocker(['volume', 'create', mysqlVolume]);
    created.mysqlVolume = true;

    runDocker(['volume', 'create', dataVolume]);
    created.dataVolume = true;

    // Start disposable MySQL 8.4 container (host native platform)
    runDocker([
      'run', '-d',
      '--name', mysqlContainer,
      '--network', networkName,
      '--network-alias', 'mysql',
      '-v', `${mysqlVolume}:/var/lib/mysql`,
      '-e', `MYSQL_ROOT_PASSWORD=${rootPassword}`,
      '-e', `MYSQL_DATABASE=${dbName}`,
      '-e', 'MYSQL_USER=yuncms',
      '-e', `MYSQL_PASSWORD=${appPassword}`,
      'mysql:8.4',
      '--character-set-server=utf8mb4',
      '--collation-server=utf8mb4_unicode_ci',
    ]);
    created.mysqlContainer = true;

    // Wait for MySQL to accept connections from candidate image (max 60 seconds)
    let mysqlReady = false;
    let lastProbeError = null;
    const deadline = Date.now() + 60_000;
    while (!mysqlReady && Date.now() < deadline) {
      try {
        runDocker([
          'run', '--rm',
          '--platform', targetPlatform,
          '--network', networkName,
          '-e', `MYSQL_PWD=${appPassword}`,
          '--entrypoint', 'mysql',
          imageName,
          '-h', 'mysql',
          '-u', 'yuncms',
          '-e', 'SELECT 1',
          dbName,
        ], { timeoutMs: 10_000 });
        mysqlReady = true;
      } catch (err) {
        lastProbeError = err;
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
    }
    if (!mysqlReady) {
      throw new Error(`Disposable MySQL 8.4 container did not accept connections within timeout: ${lastProbeError?.message ?? 'unknown'}`);
    }

    const commonEnv = [
      '-e', 'DB_HOST=mysql',
      '-e', 'DB_PORT=3306',
      '-e', `DB_DATABASE=${dbName}`,
      '-e', 'DB_USER=yuncms',
      '-e', `DB_PASSWORD=${appPassword}`,
      '-e', 'FILES_LOCAL_ROOT=/data/uploads',
    ];

    const fixturesPath = resolve(import.meta.dirname, 'fixtures');

    // Step A: Run yuncms bootstrap CLI in candidate container
    runDocker([
      'run', '--rm',
      '--platform', targetPlatform,
      '--network', networkName,
      '-v', `${dataVolume}:/data`,
      ...commonEnv,
      imageName,
      'bootstrap',
    ]);

    // Step B: Run worker setup to create STORED/VIRTUAL columns, items and uploaded file
    runDocker([
      'run', '--rm',
      '--platform', targetPlatform,
      '--network', networkName,
      '-v', `${dataVolume}:/data`,
      '-v', `${fixturesPath}:/opt/test-fixtures:ro`,
      ...commonEnv,
      '--entrypoint', 'node',
      imageName,
      '/opt/test-fixtures/docker-backup-worker.mjs',
      'setup',
    ]);

    // Step C: Run yuncms backup CLI
    const backupDir = '/data/test-docker-backup';
    runDocker([
      'run', '--rm',
      '--platform', targetPlatform,
      '--network', networkName,
      '-v', `${dataVolume}:/data`,
      ...commonEnv,
      imageName,
      'backup',
      '--output', backupDir,
    ]);

    // Step D: Mutate rows in database and file on disk to guarantee restore is genuinely tested
    runDocker([
      'run', '--rm',
      '--platform', targetPlatform,
      '--network', networkName,
      '-v', `${dataVolume}:/data`,
      '-v', `${fixturesPath}:/opt/test-fixtures:ro`,
      ...commonEnv,
      '--entrypoint', 'node',
      imageName,
      '/opt/test-fixtures/docker-backup-worker.mjs',
      'mutate',
    ]);

    // Step E: Run yuncms restore CLI with --yes
    runDocker([
      'run', '--rm',
      '--platform', targetPlatform,
      '--network', networkName,
      '-v', `${dataVolume}:/data`,
      ...commonEnv,
      imageName,
      'restore',
      backupDir,
      '--yes',
    ]);

    // Step F: Run worker verify to assert generated columns, roles, and files are preserved
    runDocker([
      'run', '--rm',
      '--platform', targetPlatform,
      '--network', networkName,
      '-v', `${dataVolume}:/data`,
      '-v', `${fixturesPath}:/opt/test-fixtures:ro`,
      ...commonEnv,
      '--entrypoint', 'node',
      imageName,
      '/opt/test-fixtures/docker-backup-worker.mjs',
      'verify',
    ]);

  } finally {
    if (created.mysqlContainer) {
      try {
        runDocker(['rm', '-f', mysqlContainer]);
      } catch (error) {
        cleanupErrors.push(error);
      }
    }
    if (created.dataVolume) {
      try {
        runDocker(['volume', 'rm', '-f', dataVolume]);
      } catch (error) {
        cleanupErrors.push(error);
      }
    }
    if (created.mysqlVolume) {
      try {
        runDocker(['volume', 'rm', '-f', mysqlVolume]);
      } catch (error) {
        cleanupErrors.push(error);
      }
    }
    if (created.network) {
      try {
        runDocker(['network', 'rm', networkName]);
      } catch (error) {
        cleanupErrors.push(error);
      }
    }
    if (cleanupErrors.length > 0) {
      if (cleanupErrors.length === 1) throw cleanupErrors[0];
      throw new AggregateError(cleanupErrors, `Docker test cleanup failed with ${cleanupErrors.length} error(s)`);
    }
  }
});
