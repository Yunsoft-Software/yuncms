import {
  access,
  lstat,
  mkdtemp,
  readFile,
  readdir,
  rm,
  statfs,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { isAbsolute, join, resolve } from 'node:path';

import {
  closeDatabasePool,
  createDatabasePool,
  loadConfig,
  pingDatabase,
  readAppliedMigrations,
  readMigrationAttempts,
} from '@yunsoft/yuncms-core';

import { runCapturedProcess } from './process-runner.js';
import { isLocalYunCmsReachable } from './service-state.js';

const MIN_FREE_HEADROOM_BYTES = 256 * 1024 * 1024;
const SEMVER_PATTERN = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*))*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;
const DEPENDENCY_SECTIONS = Object.freeze(['dependencies', 'devDependencies', 'optionalDependencies']);

function updateError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

async function readJson(path, code) {
  try {
    return JSON.parse(await readFile(path, 'utf8'));
  } catch (error) {
    if (error?.code === 'ENOENT' || error instanceof SyntaxError) {
      throw updateError(code, `Missing or invalid JSON file: ${path}`);
    }
    throw error;
  }
}

function projectDependencySection(packageJson) {
  const matches = DEPENDENCY_SECTIONS.filter((key) => packageJson?.[key]?.['@yunsoft/yuncms']);
  if (matches.length > 1) {
    const error = updateError(
      'UPDATE_PROJECT_DEPENDENCY_AMBIGUOUS',
      `@yunsoft/yuncms is declared in multiple dependency sections: ${matches.join(', ')}`,
    );
    error.dependencySections = matches;
    throw error;
  }
  return matches[0] ?? null;
}

function parseSemanticVersion(version) {
  if (typeof version !== 'string') return null;
  const match = SEMVER_PATTERN.exec(version.trim());
  if (!match) return null;
  return {
    raw: version.trim(),
    core: [Number(match[1]), Number(match[2]), Number(match[3])],
    prerelease: match[4] ? match[4].split('.') : [],
  };
}

export async function readProjectPackageState(cwd = process.cwd()) {
  const projectPackagePath = resolve(cwd, 'package.json');
  const project = await readJson(projectPackagePath, 'UPDATE_PROJECT_PACKAGE_REQUIRED');
  const dependencySection = projectDependencySection(project);
  if (!dependencySection) {
    throw updateError(
      'UPDATE_PROJECT_PACKAGE_REQUIRED',
      'Project package.json must declare @yunsoft/yuncms before managed updates can run',
    );
  }

  const installedPath = resolve(cwd, 'node_modules', '@yunsoft', 'yuncms', 'package.json');
  const installed = await readJson(installedPath, 'UPDATE_INSTALLED_PACKAGE_REQUIRED');
  if (!installed.version) {
    throw updateError('UPDATE_INSTALLED_PACKAGE_REQUIRED', 'Installed @yunsoft/yuncms version is missing');
  }
  const currentVersion = String(installed.version);
  if (!parseSemanticVersion(currentVersion)) {
    throw updateError(
      'UPDATE_INSTALLED_VERSION_INVALID',
      `Installed @yunsoft/yuncms has an invalid semantic version: ${currentVersion}`,
    );
  }

  return {
    project,
    projectPackagePath,
    installedPackagePath: installedPath,
    currentVersion,
    dependencySection,
  };
}

function parseResolvedVersion(stdout) {
  let parsed;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    parsed = stdout.replace(/^"|"$/g, '').trim();
  }

  const candidates = Array.isArray(parsed) ? parsed : [parsed];
  if (
    candidates.length === 0
    || candidates.some((version) => typeof version !== 'string' || !parseSemanticVersion(version))
  ) {
    throw updateError('UPDATE_TARGET_VERSION_INVALID', `npm returned an invalid YunCMS version: ${stdout}`);
  }

  return candidates.reduce((best, version) => (
    best === null || compareVersions(version, best) > 0 ? version : best
  ), null);
}

export async function resolveTargetVersion(specifier = 'latest', {
  cwd = process.cwd(),
  env = process.env,
  runProcess = runCapturedProcess,
} = {}) {
  const result = await runProcess(
    'npm',
    ['view', `@yunsoft/yuncms@${specifier}`, 'version', '--json'],
    { cwd, env },
  );
  return parseResolvedVersion(result.stdout);
}

function comparePrerelease(left, right) {
  if (left.length === 0 && right.length === 0) return 0;
  if (left.length === 0) return 1;
  if (right.length === 0) return -1;

  const length = Math.max(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    if (left[index] === undefined) return -1;
    if (right[index] === undefined) return 1;
    if (left[index] === right[index]) continue;

    const leftNumeric = /^\d+$/.test(left[index]);
    const rightNumeric = /^\d+$/.test(right[index]);
    if (leftNumeric && rightNumeric) {
      const leftNumber = Number(left[index]);
      const rightNumber = Number(right[index]);
      return leftNumber < rightNumber ? -1 : 1;
    }
    if (leftNumeric !== rightNumeric) return leftNumeric ? -1 : 1;
    return left[index] < right[index] ? -1 : 1;
  }
  return 0;
}

export function compareVersions(left, right) {
  const a = parseSemanticVersion(left);
  const b = parseSemanticVersion(right);
  if (!a || !b) {
    const error = updateError(
      'UPDATE_VERSION_INVALID',
      `Cannot compare invalid semantic versions: ${left} and ${right}`,
    );
    error.left = left;
    error.right = right;
    throw error;
  }
  for (let index = 0; index < 3; index += 1) {
    if (a.core[index] !== b.core[index]) return a.core[index] < b.core[index] ? -1 : 1;
  }
  return comparePrerelease(a.prerelease, b.prerelease);
}

export function analyzeMigrationHistory(appliedMigrations, targetMigrations) {
  const applied = Array.isArray(appliedMigrations) ? appliedMigrations : [];
  const target = Array.isArray(targetMigrations) ? targetMigrations : [];
  const appliedSet = new Set(applied);
  const targetSet = new Set(target);
  const unknownAppliedMigrations = applied.filter((id) => !targetSet.has(id));
  const pendingMigrations = target.filter((id) => !appliedSet.has(id));
  const migrationHistoryGap = [];
  let sawMissing = false;

  for (const id of target) {
    if (!appliedSet.has(id)) {
      sawMissing = true;
      continue;
    }
    if (sawMissing) migrationHistoryGap.push(id);
  }

  return {
    pendingMigrations,
    unknownAppliedMigrations,
    migrationHistoryGap,
    compatible: unknownAppliedMigrations.length === 0 && migrationHistoryGap.length === 0,
  };
}

export function findIncompleteMigrationAttempts(appliedMigrations, attempts) {
  const applied = new Set(Array.isArray(appliedMigrations) ? appliedMigrations : []);
  return (Array.isArray(attempts) ? attempts : [])
    .filter((attempt) => attempt && !applied.has(attempt.migration_id))
    .map((attempt) => ({ ...attempt }));
}

async function inspectTargetMigrations(targetVersion, {
  env,
  runProcess,
} = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'yuncms-update-'));
  try {
    await writeFile(
      join(directory, 'package.json'),
      `${JSON.stringify({ private: true }, null, 2)}\n`,
      'utf8',
    );
    await runProcess(
      'npm',
      [
        'install',
        '--ignore-scripts',
        '--no-audit',
        '--no-fund',
        '--package-lock=false',
        '--save-exact',
        `@yunsoft/yuncms@${targetVersion}`,
      ],
      { cwd: directory, env },
    );

    const script = [
      "import { REQUIRED_CORE_MIGRATION_IDS } from '@yunsoft/yuncms-core';",
      'process.stdout.write(JSON.stringify(REQUIRED_CORE_MIGRATION_IDS));',
    ].join(' ');
    const result = await runProcess(
      process.execPath,
      ['--input-type=module', '-e', script],
      { cwd: directory, env },
    );
    const migrations = JSON.parse(result.stdout);
    if (
      !Array.isArray(migrations)
      || migrations.some((id) => typeof id !== 'string' || !id)
      || new Set(migrations).size !== migrations.length
    ) {
      throw updateError('UPDATE_TARGET_MIGRATIONS_INVALID', 'Target package exposed an invalid migration list');
    }
    return migrations;
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

async function readExistingMigrationAttempts(pool) {
  try {
    return await readMigrationAttempts(pool);
  } catch (error) {
    if (error?.code === 'ER_NO_SUCH_TABLE') return [];
    throw error;
  }
}

async function collectDatabaseState(config, {
  createPool = createDatabasePool,
  closePool = closeDatabasePool,
} = {}) {
  const pool = createPool(config.database);
  try {
    if (!(await pingDatabase(pool))) {
      throw updateError('DATABASE_UNAVAILABLE', 'Database connectivity check failed');
    }
    const applied = [...await readAppliedMigrations(pool)].sort();
    const attempts = await readExistingMigrationAttempts(pool);
    const [rows] = await pool.query(
      `SELECT COALESCE(SUM(data_length + index_length), 0) AS bytes
       FROM information_schema.tables
       WHERE table_schema = ?`,
      [config.database.database],
    );
    return {
      appliedMigrations: applied,
      migrationAttempts: attempts,
      incompleteMigrationAttempts: findIncompleteMigrationAttempts(applied, attempts),
      estimatedBytes: Number(rows?.[0]?.bytes ?? 0),
    };
  } finally {
    await closePool(pool);
  }
}

async function diskState(cwd) {
  const info = await statfs(cwd);
  return {
    freeBytes: Number(info.bavail) * Number(info.bsize),
  };
}

async function pathSize(path) {
  let info;
  try {
    info = await lstat(path);
  } catch (error) {
    if (error?.code === 'ENOENT') return 0;
    throw error;
  }

  if (info.isSymbolicLink()) return info.size;
  if (info.isFile()) return info.size;
  if (!info.isDirectory()) return 0;

  const entries = await readdir(path, { withFileTypes: true });
  let bytes = 0;
  for (const entry of entries) {
    bytes += await pathSize(join(path, entry.name));
  }
  return bytes;
}

async function collectLocalBackupBytes(cwd, config) {
  const localFilesPath = isAbsolute(config.storage.localRoot)
    ? config.storage.localRoot
    : resolve(cwd, config.storage.localRoot);
  const paths = [
    localFilesPath,
    resolve(cwd, 'extensions'),
    resolve(cwd, '.env'),
    resolve(cwd, 'package.json'),
    resolve(cwd, 'package-lock.json'),
  ];
  let bytes = 0;
  for (const path of paths) bytes += await pathSize(path);
  return bytes;
}

async function assertRequiredTools({ cwd, env, runProcess }) {
  await Promise.all([
    runProcess('npm', ['--version'], { cwd, env }),
    runProcess('mysqldump', ['--version'], { cwd, env }),
    runProcess('mysql', ['--version'], { cwd, env }),
  ]);
}

export async function collectUpdatePreflight({
  cwd = process.cwd(),
  env = process.env,
  target = 'latest',
  allowUnverifiedS3 = false,
  runProcess = runCapturedProcess,
  fetchFn = globalThis.fetch,
  inspectMigrations = inspectTargetMigrations,
} = {}) {
  await access(cwd);
  const config = loadConfig(env);
  const packageState = await readProjectPackageState(cwd);
  await assertRequiredTools({ cwd, env, runProcess });
  const targetVersion = await resolveTargetVersion(target, { cwd, env, runProcess });
  const database = await collectDatabaseState(config);
  const targetMigrations = await inspectMigrations(targetVersion, { env, runProcess });
  const running = await isLocalYunCmsReachable({
    host: config.server.host,
    port: config.server.port,
    fetchFn,
  });
  const [disk, localBackupBytes] = await Promise.all([
    diskState(cwd),
    collectLocalBackupBytes(cwd, config),
  ]);

  const migrationHistory = analyzeMigrationHistory(database.appliedMigrations, targetMigrations);
  const minimumFreeBytes = database.estimatedBytes + localBackupBytes + MIN_FREE_HEADROOM_BYTES;
  const blockers = [];

  if (running) blockers.push('UPDATE_APPLICATION_RUNNING');
  if (database.incompleteMigrationAttempts.length > 0) blockers.push('UPDATE_MIGRATION_RECOVERY_REQUIRED');
  if (config.storage.s3.bucket && !allowUnverifiedS3) blockers.push('UPDATE_S3_BACKUP_UNVERIFIED');
  if (disk.freeBytes < minimumFreeBytes) blockers.push('UPDATE_DISK_SPACE_INSUFFICIENT');
  if (!migrationHistory.compatible) blockers.push('UPDATE_MIGRATION_HISTORY_INCOMPATIBLE');
  if (compareVersions(targetVersion, packageState.currentVersion) < 0) blockers.push('UPDATE_DOWNGRADE_FORBIDDEN');

  return {
    currentVersion: packageState.currentVersion,
    targetVersion,
    dependencySection: packageState.dependencySection,
    upToDate: targetVersion === packageState.currentVersion,
    running,
    databaseBytes: database.estimatedBytes,
    localBackupBytes,
    freeDiskBytes: disk.freeBytes,
    minimumFreeBytes,
    appliedMigrations: database.appliedMigrations,
    targetMigrations,
    pendingMigrations: migrationHistory.pendingMigrations,
    unknownAppliedMigrations: migrationHistory.unknownAppliedMigrations,
    migrationHistoryGap: migrationHistory.migrationHistoryGap,
    incompleteMigrationAttempts: database.incompleteMigrationAttempts,
    s3Configured: Boolean(config.storage.s3.bucket),
    s3Bucket: config.storage.s3.bucket || null,
    blockers,
  };
}

export function assertUpdatePreflightReady(report) {
  if (report.blockers.length === 0) return true;
  const error = updateError(
    'UPDATE_PREFLIGHT_FAILED',
    `Update preflight failed: ${report.blockers.join(', ')}`,
  );
  error.blockers = [...report.blockers];
  error.report = report;
  throw error;
}
