import { access, mkdtemp, readFile, rm, statfs, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import {
  closeDatabasePool,
  createDatabasePool,
  loadConfig,
  pingDatabase,
  readAppliedMigrations,
} from '@yunsoft/yuncms-core';

import { runCapturedProcess } from './process-runner.js';

const MIN_FREE_HEADROOM_BYTES = 256 * 1024 * 1024;

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

function projectDeclaresYunCms(packageJson) {
  return ['dependencies', 'devDependencies', 'optionalDependencies']
    .some((key) => packageJson?.[key]?.['@yunsoft/yuncms']);
}

export async function readProjectPackageState(cwd = process.cwd()) {
  const projectPackagePath = resolve(cwd, 'package.json');
  const project = await readJson(projectPackagePath, 'UPDATE_PROJECT_PACKAGE_REQUIRED');
  if (!projectDeclaresYunCms(project)) {
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

  return {
    project,
    projectPackagePath,
    installedPackagePath: installedPath,
    currentVersion: String(installed.version),
  };
}

function parseResolvedVersion(stdout) {
  let parsed;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    parsed = stdout.replace(/^"|"$/g, '').trim();
  }
  const version = Array.isArray(parsed) ? parsed.at(-1) : parsed;
  if (typeof version !== 'string' || !/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(version)) {
    throw updateError('UPDATE_TARGET_VERSION_INVALID', `npm returned an invalid YunCMS version: ${stdout}`);
  }
  return version;
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

function numericVersion(version) {
  const match = /^(\d+)\.(\d+)\.(\d+)/.exec(version);
  if (!match) return null;
  return match.slice(1).map(Number);
}

export function compareVersions(left, right) {
  const a = numericVersion(left);
  const b = numericVersion(right);
  if (!a || !b) return 0;
  for (let index = 0; index < 3; index += 1) {
    if (a[index] !== b[index]) return a[index] < b[index] ? -1 : 1;
  }
  return 0;
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
    if (!Array.isArray(migrations) || migrations.some((id) => typeof id !== 'string')) {
      throw updateError('UPDATE_TARGET_MIGRATIONS_INVALID', 'Target package exposed an invalid migration list');
    }
    return migrations;
  } finally {
    await rm(directory, { recursive: true, force: true });
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
    const [rows] = await pool.query(
      `SELECT COALESCE(SUM(data_length + index_length), 0) AS bytes
       FROM information_schema.tables
       WHERE table_schema = ?`,
      [config.database.database],
    );
    return {
      appliedMigrations: applied,
      estimatedBytes: Number(rows?.[0]?.bytes ?? 0),
    };
  } finally {
    await closePool(pool);
  }
}

async function detectRunningApi(config, fetchFn = globalThis.fetch) {
  if (typeof fetchFn !== 'function') return false;
  const url = `http://127.0.0.1:${config.server.port}/health`;
  try {
    const response = await fetchFn(url, { signal: AbortSignal.timeout(1200) });
    return response.status >= 100 && response.status < 600;
  } catch {
    return false;
  }
}

async function diskState(cwd) {
  const info = await statfs(cwd);
  return {
    freeBytes: Number(info.bavail) * Number(info.bsize),
  };
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
  const running = await detectRunningApi(config, fetchFn);
  const disk = await diskState(cwd);

  const appliedSet = new Set(database.appliedMigrations);
  const targetSet = new Set(targetMigrations);
  const pendingMigrations = targetMigrations.filter((id) => !appliedSet.has(id));
  const unknownAppliedMigrations = database.appliedMigrations.filter((id) => !targetSet.has(id));
  const minimumFreeBytes = database.estimatedBytes + MIN_FREE_HEADROOM_BYTES;
  const blockers = [];

  if (running) blockers.push('UPDATE_APPLICATION_RUNNING');
  if (config.storage.s3.bucket && !allowUnverifiedS3) blockers.push('UPDATE_S3_BACKUP_UNVERIFIED');
  if (disk.freeBytes < minimumFreeBytes) blockers.push('UPDATE_DISK_SPACE_INSUFFICIENT');
  if (unknownAppliedMigrations.length > 0) blockers.push('UPDATE_MIGRATION_HISTORY_INCOMPATIBLE');
  if (compareVersions(targetVersion, packageState.currentVersion) < 0) blockers.push('UPDATE_DOWNGRADE_FORBIDDEN');

  return {
    currentVersion: packageState.currentVersion,
    targetVersion,
    upToDate: targetVersion === packageState.currentVersion,
    running,
    databaseBytes: database.estimatedBytes,
    freeDiskBytes: disk.freeBytes,
    minimumFreeBytes,
    appliedMigrations: database.appliedMigrations,
    targetMigrations,
    pendingMigrations,
    unknownAppliedMigrations,
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
