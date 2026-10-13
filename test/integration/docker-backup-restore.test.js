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
  assert.equal(uid, '1000', `Container must execute as the stable unprivileged UID 1000, got: ${uid}`);

  const mysqlVersion = runDocker(['run', '--rm', '--platform', targetPlatform, '--entrypoint', 'mysql', imageName, '--version']).trim();
  assert.match(mysqlVersion, /MySQL/i, `Container mysql client must identify as MySQL, got: ${mysqlVersion}`);
  assert.doesNotMatch(mysqlVersion, /MariaDB/i, `Container mysql client must not identify as MariaDB, got: ${mysqlVersion}`);

  const mysqldumpVersion = runDocker(['run', '--rm', '--platform', targetPlatform, '--entrypoint', 'mysqldump', imageName, '--version']).trim();
  assert.match(mysqldumpVersion, /MySQL/i, `Container mysqldump client must identify as MySQL, got: ${mysqldumpVersion}`);
  assert.doesNotMatch(mysqldumpVersion, /MariaDB/i, `Container mysqldump client must not identify as MariaDB, got: ${mysqldumpVersion}`);

  // Check the actual image, including the distro security floors from the OS audit.
  const osId = runDocker(['run', '--rm', '--platform', targetPlatform, '--entrypoint', 'sh', imageName,
    '-c', '. /etc/os-release; printf "%s" "$ID"']).trim();
  assert.equal(osId, 'wolfi');
  const privilegedFiles = runDocker(['run', '--rm', '--platform', targetPlatform, '--entrypoint', 'find', imageName,
    '/usr', '/opt', '-xdev', '-type', 'f', '-perm', '/6000', '-print']).trim();
  assert.equal(privilegedFiles, '', 'Image must not retain SUID or SGID files');
  runDocker(['run', '--rm', '--platform', targetPlatform, '--entrypoint', 'sh', imageName,
    '-c', 'test ! -e /usr/bin/infocmp']);
  const installedPackages = JSON.parse(runDocker(['run', '--rm', '--platform', targetPlatform, '--entrypoint', 'node', imageName,
    '-e', String.raw`const fs = require('node:fs'); const packages = Object.fromEntries(fs.readFileSync('/lib/apk/db/installed', 'utf8').trim().split('\n\n').map(record => { const fields = Object.fromEntries(record.split('\n').filter(line => /^[PV]:/.test(line)).map(line => [line[0], line.slice(2)])); return [fields.P, fields.V]; })); console.log(JSON.stringify(packages));`]));
  for (const pkg of ['wolfi-base', 'wolfi-baselayout', 'busybox', 'tini', 'ncurses', 'libssl3', 'libcrypto3']) {
    assert.ok(installedPackages[pkg], `Required runtime package must be present: ${pkg}`);
  }
  for (const pkg of ['util-linux', 'mount', 'bsdutils', 'login', 'acl', 'libacl1', 'systemd', 'libsystemd0', 'libudev1', 'perl', 'perl-base']) {
    assert.equal(installedPackages[pkg], undefined, `Unused vulnerable component must not be installed: ${pkg}`);
  }
  for (const [pkg, floor] of [
    ['ncurses', '6.5.20251213-r0'],
    ['openssl-4.0-libssl', '4.0.3-r0'],
    ['openssl-4.0-libcrypto', '4.0.3-r0'],
  ]) {
    assert.ok(installedPackages[pkg], `Patched library must be present: ${pkg}`);
    const comparison = runDocker(['run', '--rm', '--platform', targetPlatform, '--entrypoint', 'apk', imageName,
      'version', '-t', installedPackages[pkg], floor]).trim();
    assert.ok(['=', '>'].includes(comparison), `Runtime package must meet security floor: ${pkg}`);
  }
  const npmVersion = runDocker(['run', '--rm', '--platform', targetPlatform, '--entrypoint', 'npm', imageName, '--version']).trim();
  assert.ok(Number(npmVersion.split('.')[0]) >= 11, 'Official Node 24 bundled npm must remain executable');
  const privilegeState = JSON.parse(runDocker(['run', '--rm', '--platform', targetPlatform,
    '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges', '--read-only', '--entrypoint', 'node', imageName,
    '-e', String.raw`const fs = require('node:fs'); const status = fs.readFileSync('/proc/self/status', 'utf8'); console.log(JSON.stringify(Object.fromEntries(status.split('\n').filter(line => /^(Cap(Inh|Prm|Eff|Bnd|Amb)|NoNewPrivs):/.test(line)).map(line => line.split(/:\s+/)))));`]));
  for (const key of ['CapInh', 'CapPrm', 'CapEff', 'CapBnd', 'CapAmb']) assert.match(privilegeState[key], /^0+$/);
  assert.equal(privilegeState.NoNewPrivs, '1');

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

    // Exercise the copied MySQL client against the runtime's TLS libraries.
    const clientArgs = ['run', '--rm', '--platform', targetPlatform, '--network', networkName,
      '-e', `MYSQL_PWD=${appPassword}`, '--entrypoint', 'mysql', imageName, '-h', 'mysql', '-u', 'yuncms'];
    const tlsStatus = runDocker([...clientArgs, '--ssl-mode=REQUIRED', '--batch', '--skip-column-names',
      '-e', "SHOW SESSION STATUS LIKE 'Ssl_cipher'", dbName]).trim();
    assert.match(tlsStatus, /^Ssl_cipher\s+\S+$/, 'Native MySQL client must negotiate encrypted transport');
    assert.throws(() => runDocker([...clientArgs, '--ssl-mode=VERIFY_IDENTITY', '-e', 'SELECT 1', dbName]),
      /SSL connection error|certificate|CA certificate|hostname/i, 'Untrusted auto-generated server certificate must fail verification');

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
