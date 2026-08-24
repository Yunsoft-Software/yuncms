import {
  constants as fsConstants,
  access,
  copyFile,
  cp,
  lstat,
  mkdir,
  readFile,
  realpath,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path';

import { loadConfig } from '@yunsoft/yuncms-core';

import {
  assertBackupAssetType,
  hashDirectory,
  hashFile,
  verifyAssetDigest,
} from './backup-integrity.js';
import {
  dumpDatabase,
  restoreDatabase,
  verifyDatabaseDump,
} from './database-backup.js';
import { resetDatabaseObjects } from './database-reset.js';

const LEGACY_BACKUP_FORMAT_VERSION = 1;
export const BACKUP_FORMAT_VERSION = 2;
const SUPPORTED_BACKUP_FORMATS = new Set([LEGACY_BACKUP_FORMAT_VERSION, BACKUP_FORMAT_VERSION]);
const SHA256_PATTERN = /^[0-9a-f]{64}$/i;
const AI_SETTINGS_KEY_RELATIVE_PATH = join('.yuncms', 'ai-settings.key');

async function exists(path) {
  try {
    await access(path, fsConstants.F_OK);
    return true;
  } catch (error) {
    if (error?.code === 'ENOENT') return false;
    throw error;
  }
}

function pathInside(parent, candidate) {
  const rel = relative(resolve(parent), resolve(candidate));
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
}

function safeTimestamp(date) {
  return date.toISOString().replace(/[:.]/g, '-');
}

export function defaultBackupPath(cwd, date = new Date()) {
  return join(cwd, '.yuncms', 'backups', safeTimestamp(date));
}

function resolveProjectPath(cwd, value) {
  return isAbsolute(value) ? value : resolve(cwd, value);
}

function manifestError(manifestPath, message) {
  const error = new Error(`Invalid YunCMS backup manifest ${manifestPath}: ${message}`);
  error.code = 'BACKUP_MANIFEST_INVALID';
  error.manifestPath = manifestPath;
  return error;
}

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function assertManifestString(value, name, manifestPath, { nullable = false } = {}) {
  if (nullable && value === null) return;
  if (typeof value !== 'string' || !value.trim()) {
    throw manifestError(manifestPath, `${name} must be a non-empty string${nullable ? ' or null' : ''}`);
  }
}

function assertManifestBoolean(value, name, manifestPath) {
  if (typeof value !== 'boolean') throw manifestError(manifestPath, `${name} must be boolean`);
}

function assertDigest(value, name, manifestPath, { nullable = false } = {}) {
  if (nullable && value === null) return;
  if (typeof value !== 'string' || !SHA256_PATTERN.test(value)) {
    throw manifestError(manifestPath, `${name} must be a SHA-256 digest${nullable ? ' or null' : ''}`);
  }
}

function validateBackupManifest(manifest, manifestPath) {
  if (!isObject(manifest)) throw manifestError(manifestPath, 'root must be an object');
  if (!SUPPORTED_BACKUP_FORMATS.has(manifest.format)) {
    throw manifestError(manifestPath, `unsupported backup format ${manifest.format}`);
  }
  if (manifest.complete !== true) throw manifestError(manifestPath, 'backup is incomplete');
  if (typeof manifest.createdAt !== 'string' || Number.isNaN(Date.parse(manifest.createdAt))) {
    throw manifestError(manifestPath, 'createdAt must be a valid timestamp');
  }

  if (!isObject(manifest.database)) throw manifestError(manifestPath, 'database metadata is required');
  assertManifestString(manifest.database.host, 'database.host', manifestPath);
  if (!Number.isInteger(Number(manifest.database.port)) || Number(manifest.database.port) < 1 || Number(manifest.database.port) > 65535) {
    throw manifestError(manifestPath, 'database.port must be between 1 and 65535');
  }
  assertManifestString(manifest.database.database, 'database.database', manifestPath);
  assertManifestString(manifest.database.user, 'database.user', manifestPath);
  assertManifestBoolean(manifest.database.ssl, 'database.ssl', manifestPath);
  if (!Number.isFinite(Number(manifest.database.verifiedDecompressedBytes)) || Number(manifest.database.verifiedDecompressedBytes) <= 0) {
    throw manifestError(manifestPath, 'database.verifiedDecompressedBytes must be greater than zero');
  }

  if (!isObject(manifest.project)) throw manifestError(manifestPath, 'project metadata is required');
  for (const key of ['env', 'packageJson', 'packageLock', 'extensions', 'localFiles']) {
    assertManifestBoolean(manifest.project[key], `project.${key}`, manifestPath);
  }
  if (manifest.project.aiSettingsKey !== undefined) {
    assertManifestBoolean(manifest.project.aiSettingsKey, 'project.aiSettingsKey', manifestPath);
  }
  assertManifestString(manifest.project.localFilesRoot, 'project.localFilesRoot', manifestPath);

  if (!isObject(manifest.s3)) throw manifestError(manifestPath, 's3 metadata is required');
  assertManifestBoolean(manifest.s3.configured, 's3.configured', manifestPath);
  assertManifestString(manifest.s3.bucket, 's3.bucket', manifestPath, { nullable: true });
  assertManifestBoolean(manifest.s3.objectsBackedUp, 's3.objectsBackedUp', manifestPath);
  if (manifest.s3.configured && !manifest.s3.bucket) {
    throw manifestError(manifestPath, 's3.bucket is required when S3 is configured');
  }

  if (manifest.format === BACKUP_FORMAT_VERSION) {
    if (!isObject(manifest.integrity) || manifest.integrity.algorithm !== 'sha256') {
      throw manifestError(manifestPath, 'integrity.algorithm must be sha256');
    }
    assertDigest(manifest.integrity.database, 'integrity.database', manifestPath);
    if (!isObject(manifest.integrity.project)) {
      throw manifestError(manifestPath, 'integrity.project is required');
    }
    for (const [key, present, optionalLegacy] of [
      ['env', manifest.project.env, false],
      ['packageJson', manifest.project.packageJson, false],
      ['packageLock', manifest.project.packageLock, false],
      ['extensions', manifest.project.extensions, false],
      ['localFiles', manifest.project.localFiles, false],
      ['aiSettingsKey', manifest.project.aiSettingsKey === true, manifest.project.aiSettingsKey === undefined],
    ]) {
      const digest = manifest.integrity.project[key];
      if (present) assertDigest(digest, `integrity.project.${key}`, manifestPath);
      else if (!optionalLegacy && digest !== null) {
        throw manifestError(manifestPath, `integrity.project.${key} must be null when the asset is absent`);
      } else if (optionalLegacy && digest !== undefined && digest !== null) {
        throw manifestError(manifestPath, `integrity.project.${key} must be null when the legacy manifest has no asset flag`);
      }
    }
  }

  return manifest;
}

async function copyOptionalFile(source, target) {
  const present = await assertBackupAssetType(source, 'file', { optional: true });
  if (!present) return false;
  await mkdir(dirname(target), { recursive: true, mode: 0o700 });
  await copyFile(source, target);
  return true;
}

async function copyOptionalDirectory(source, target) {
  const present = await assertBackupAssetType(source, 'directory', { optional: true });
  if (!present) return false;
  await cp(source, target, { recursive: true, force: false, errorOnExist: true });
  return true;
}

function backupPathConflict(source, destination) {
  const error = new Error(`Backup destination cannot be inside a snapshotted directory: ${source}`);
  error.code = 'BACKUP_PATH_CONFLICT';
  error.sourcePath = source;
  error.backupPath = destination;
  return error;
}

function restorePathConflict(target, backupPath) {
  const error = new Error(`Backup source cannot be inside a directory that restore will replace: ${target}`);
  error.code = 'BACKUP_RESTORE_PATH_CONFLICT';
  error.targetPath = target;
  error.backupPath = backupPath;
  return error;
}

async function assertDirectory(path, code) {
  const info = await stat(path).catch((error) => {
    if (error?.code === 'ENOENT') {
      const missing = new Error(`Backup directory does not exist: ${path}`);
      missing.code = code;
      throw missing;
    }
    throw error;
  });
  if (!info.isDirectory()) {
    const error = new Error(`Expected a backup directory: ${path}`);
    error.code = code;
    throw error;
  }
}

function missingBackupAsset(path) {
  const error = new Error(`Backup is missing an asset declared by its manifest: ${path}`);
  error.code = 'BACKUP_ASSET_MISSING';
  error.assetPath = path;
  return error;
}

async function assertExpectedBackupAssets(backupPath, manifest) {
  const expected = [
    [manifest.project.env, join(backupPath, 'project', '.env'), 'file'],
    [manifest.project.packageJson, join(backupPath, 'project', 'package.json'), 'file'],
    [manifest.project.packageLock, join(backupPath, 'project', 'package-lock.json'), 'file'],
    [manifest.project.aiSettingsKey === true, join(backupPath, 'project', 'ai-settings.key'), 'file'],
    [manifest.project.extensions, join(backupPath, 'extensions'), 'directory'],
    [manifest.project.localFiles, join(backupPath, 'files'), 'directory'],
  ];

  for (const [required, path, kind] of expected) {
    if (!required) continue;
    const present = await assertBackupAssetType(path, kind, { optional: true });
    if (!present) throw missingBackupAsset(path);
  }
}

async function calculateBackupIntegrity(destination, presence) {
  return {
    algorithm: 'sha256',
    database: await hashFile(join(destination, 'database.sql.gz')),
    project: {
      env: presence.env ? await hashFile(join(destination, 'project', '.env')) : null,
      packageJson: presence.packageJson ? await hashFile(join(destination, 'project', 'package.json')) : null,
      packageLock: presence.packageLock ? await hashFile(join(destination, 'project', 'package-lock.json')) : null,
      aiSettingsKey: presence.aiSettingsKey ? await hashFile(join(destination, 'project', 'ai-settings.key')) : null,
      extensions: presence.extensions ? await hashDirectory(join(destination, 'extensions')) : null,
      localFiles: presence.localFiles ? await hashDirectory(join(destination, 'files')) : null,
    },
  };
}

async function verifyBackupIntegrity(backupPath, manifest) {
  if (manifest.format === LEGACY_BACKUP_FORMAT_VERSION) return false;
  await verifyAssetDigest(join(backupPath, 'database.sql.gz'), 'file', manifest.integrity.database);
  for (const [key, relativePath, kind] of [
    ['env', ['project', '.env'], 'file'],
    ['packageJson', ['project', 'package.json'], 'file'],
    ['packageLock', ['project', 'package-lock.json'], 'file'],
    ['aiSettingsKey', ['project', 'ai-settings.key'], 'file'],
    ['extensions', ['extensions'], 'directory'],
    ['localFiles', ['files'], 'directory'],
  ]) {
    if (!manifest.project[key]) continue;
    await verifyAssetDigest(join(backupPath, ...relativePath), kind, manifest.integrity.project[key]);
  }
  return true;
}

async function nearestExistingAncestor(path) {
  let current = resolve(path);
  while (true) {
    try {
      await lstat(current);
      return current;
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
      const parent = dirname(current);
      if (parent === current) throw error;
      current = parent;
    }
  }
}

async function assertRestoreTarget(target, kind) {
  let info = null;
  try {
    info = await lstat(target);
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }

  if (info?.isSymbolicLink()) {
    const error = new Error(`Restore target cannot be a symbolic link: ${target}`);
    error.code = 'BACKUP_RESTORE_TARGET_INVALID';
    error.targetPath = target;
    throw error;
  }
  if (info && kind === 'file' && !info.isFile()) {
    const error = new Error(`Restore target must be a regular file or absent: ${target}`);
    error.code = 'BACKUP_RESTORE_TARGET_INVALID';
    error.targetPath = target;
    throw error;
  }
  if (info && kind === 'directory' && !info.isDirectory()) {
    const error = new Error(`Restore target must be a directory or absent: ${target}`);
    error.code = 'BACKUP_RESTORE_TARGET_INVALID';
    error.targetPath = target;
    throw error;
  }

  const writableAncestor = await nearestExistingAncestor(dirname(target));
  try {
    await access(writableAncestor, fsConstants.W_OK);
  } catch (cause) {
    const error = new Error(`Restore target parent is not writable: ${target}`);
    error.code = 'BACKUP_RESTORE_TARGET_UNWRITABLE';
    error.targetPath = target;
    error.cause = cause;
    throw error;
  }
}

async function assertRestoreTargets(cwd, localFilesPath, extensionsPath, allowDifferentDatabaseTarget) {
  await assertRestoreTarget(localFilesPath, 'directory');
  await assertRestoreTarget(extensionsPath, 'directory');
  await assertRestoreTarget(resolve(cwd, 'package.json'), 'file');
  await assertRestoreTarget(resolve(cwd, 'package-lock.json'), 'file');
  await assertRestoreTarget(resolve(cwd, AI_SETTINGS_KEY_RELATIVE_PATH), 'file');
  if (!allowDifferentDatabaseTarget) await assertRestoreTarget(resolve(cwd, '.env'), 'file');
}

async function effectiveDestinationPath(destination) {
  const parent = dirname(destination);
  await mkdir(parent, { recursive: true, mode: 0o700 });
  const resolvedParent = await realpath(parent);
  return join(resolvedParent, basename(destination));
}

export async function readBackupManifest(backupPath) {
  const resolved = resolve(backupPath);
  await assertDirectory(resolved, 'BACKUP_NOT_FOUND');
  const manifestPath = join(resolved, 'manifest.json');
  let manifest;
  try {
    manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  } catch (error) {
    if (error?.code === 'ENOENT' || error instanceof SyntaxError) {
      throw manifestError(manifestPath, 'file is missing or invalid JSON');
    }
    throw error;
  }
  validateBackupManifest(manifest, manifestPath);

  const databaseDumpPath = join(resolved, 'database.sql.gz');
  const dumpPresent = await assertBackupAssetType(databaseDumpPath, 'file', { optional: true });
  if (!dumpPresent) {
    const error = new Error(`Database dump is missing from backup: ${resolved}`);
    error.code = 'BACKUP_DATABASE_MISSING';
    throw error;
  }
  return { backupPath: resolved, manifest };
}

export async function createProjectBackup({
  cwd = process.cwd(),
  env = process.env,
  backupPath = null,
  now = new Date(),
  dumpDatabaseFn = dumpDatabase,
  verifyDatabaseFn = verifyDatabaseDump,
  output = console,
} = {}) {
  const config = loadConfig(env);
  const destination = resolve(backupPath ?? defaultBackupPath(cwd, now));
  const localFilesPath = resolveProjectPath(cwd, config.storage.localRoot);
  const extensionsPath = resolve(cwd, 'extensions');

  const sourceKinds = [
    [localFilesPath, 'directory'],
    [extensionsPath, 'directory'],
  ];
  for (const [source, kind] of sourceKinds) {
    await assertBackupAssetType(source, kind, { optional: true });
  }

  const effectiveDestination = await effectiveDestinationPath(destination);
  for (const [source] of sourceKinds) {
    if (!(await exists(source))) continue;
    const sourceRealPath = await realpath(source);
    if (pathInside(sourceRealPath, effectiveDestination)) throw backupPathConflict(source, destination);
  }

  try {
    await mkdir(destination, { mode: 0o700 });
  } catch (error) {
    if (error?.code === 'EEXIST') {
      const conflict = new Error(`Backup destination already exists: ${destination}`);
      conflict.code = 'BACKUP_ALREADY_EXISTS';
      throw conflict;
    }
    throw error;
  }

  try {
    const databaseDumpPath = join(destination, 'database.sql.gz');
    output.log?.(`Creating database backup: ${config.database.database}`);
    await dumpDatabaseFn({ config: config.database, outputPath: databaseDumpPath, env });
    const databaseVerification = await verifyDatabaseFn({ inputPath: databaseDumpPath });

    const presence = {
      env: await copyOptionalFile(resolve(cwd, '.env'), join(destination, 'project', '.env')),
      packageJson: await copyOptionalFile(resolve(cwd, 'package.json'), join(destination, 'project', 'package.json')),
      packageLock: await copyOptionalFile(resolve(cwd, 'package-lock.json'), join(destination, 'project', 'package-lock.json')),
      aiSettingsKey: await copyOptionalFile(resolve(cwd, AI_SETTINGS_KEY_RELATIVE_PATH), join(destination, 'project', 'ai-settings.key')),
      extensions: await copyOptionalDirectory(extensionsPath, join(destination, 'extensions')),
      localFiles: await copyOptionalDirectory(localFilesPath, join(destination, 'files')),
    };
    const integrity = await calculateBackupIntegrity(destination, presence);

    const manifest = {
      format: BACKUP_FORMAT_VERSION,
      complete: true,
      createdAt: now.toISOString(),
      database: {
        host: config.database.host,
        port: config.database.port,
        database: config.database.database,
        user: config.database.user,
        ssl: config.database.ssl,
        verifiedDecompressedBytes: Number(databaseVerification?.decompressedBytes ?? 0),
      },
      project: {
        ...presence,
        localFilesRoot: config.storage.localRoot,
      },
      s3: {
        configured: Boolean(config.storage.s3.bucket),
        bucket: config.storage.s3.bucket || null,
        objectsBackedUp: false,
      },
      integrity,
    };

    validateBackupManifest(manifest, join(destination, 'manifest.json'));
    await writeFile(
      join(destination, 'manifest.json'),
      `${JSON.stringify(manifest, null, 2)}\n`,
      { encoding: 'utf8', mode: 0o600 },
    );

    output.log?.(`Backup completed: ${destination}`);
    if (manifest.s3.configured) {
      output.warn?.('S3 objects are not copied by YunCMS backup; provider-side versioning/snapshots are required.');
    }
    return { backupPath: destination, manifest };
  } catch (error) {
    await rm(destination, { recursive: true, force: true }).catch(() => {});
    throw error;
  }
}

function assertRestoreDatabaseMatches(manifest, config, allowDifferentDatabaseTarget) {
  if (allowDifferentDatabaseTarget) return;
  const expected = manifest.database;
  const actual = config.database;
  const matches = expected.database === actual.database
    && expected.host === actual.host
    && Number(expected.port) === Number(actual.port);
  if (!matches) {
    const error = new Error(
      `Backup targets ${expected.host}:${expected.port}/${expected.database}, current environment targets ${actual.host}:${actual.port}/${actual.database}`,
    );
    error.code = 'BACKUP_DATABASE_TARGET_MISMATCH';
    throw error;
  }
}

async function restoreOptionalFile({ backupPath, existed, sourceName, target }) {
  const source = join(backupPath, 'project', sourceName);
  if (!existed) {
    await rm(target, { force: true });
    return;
  }
  await mkdir(dirname(target), { recursive: true, mode: 0o700 });
  await copyFile(source, target);
}

async function restoreOptionalDirectory({ backupPath, existed, sourceName, target }) {
  const source = join(backupPath, sourceName);
  await rm(target, { recursive: true, force: true });
  if (!existed) return;
  await mkdir(dirname(target), { recursive: true });
  await cp(source, target, { recursive: true, force: false, errorOnExist: true });
}

export async function restoreProjectBackup({
  backupPath,
  cwd = process.cwd(),
  env = process.env,
  allowDifferentDatabaseTarget = false,
  restoreDatabaseFn = restoreDatabase,
  resetDatabaseFn = resetDatabaseObjects,
  verifyDatabaseFn = verifyDatabaseDump,
  beforeDestructive = null,
  output = console,
} = {}) {
  if (!backupPath) {
    const error = new Error('Backup path is required');
    error.code = 'BACKUP_PATH_REQUIRED';
    throw error;
  }
  if (beforeDestructive !== null && typeof beforeDestructive !== 'function') {
    throw new Error('beforeDestructive must be a function when provided');
  }

  const { backupPath: resolvedBackupPath, manifest } = await readBackupManifest(backupPath);
  const config = loadConfig(env);
  assertRestoreDatabaseMatches(manifest, config, allowDifferentDatabaseTarget);

  const localFilesPath = resolveProjectPath(cwd, config.storage.localRoot);
  const extensionsPath = resolve(cwd, 'extensions');
  await assertRestoreTargets(cwd, localFilesPath, extensionsPath, allowDifferentDatabaseTarget);

  const backupRealPath = await realpath(resolvedBackupPath);
  for (const target of [localFilesPath, extensionsPath]) {
    let targetPath = target;
    if (await exists(target)) targetPath = await realpath(target);
    if (pathInside(targetPath, backupRealPath)) throw restorePathConflict(target, resolvedBackupPath);
  }

  const databaseDumpPath = join(resolvedBackupPath, 'database.sql.gz');
  output.log?.(`Validating backup before destructive restore: ${resolvedBackupPath}`);
  await verifyDatabaseFn({ inputPath: databaseDumpPath });
  await assertExpectedBackupAssets(resolvedBackupPath, manifest);
  const integrityVerified = await verifyBackupIntegrity(resolvedBackupPath, manifest);
  if (!integrityVerified) {
    output.warn?.('Restoring legacy backup format 1 without SHA-256 project asset integrity hashes.');
  }
  if (beforeDestructive) await beforeDestructive();

  output.log?.(`Resetting database before restore: ${config.database.database}`);
  await resetDatabaseFn({ config: config.database });
  output.log?.(`Restoring database backup: ${resolvedBackupPath}`);
  await restoreDatabaseFn({ config: config.database, inputPath: databaseDumpPath, env });

  await restoreOptionalDirectory({
    backupPath: resolvedBackupPath,
    existed: manifest.project.localFiles,
    sourceName: 'files',
    target: localFilesPath,
  });
  await restoreOptionalDirectory({
    backupPath: resolvedBackupPath,
    existed: manifest.project.extensions,
    sourceName: 'extensions',
    target: extensionsPath,
  });
  await restoreOptionalFile({
    backupPath: resolvedBackupPath,
    existed: manifest.project.packageJson,
    sourceName: 'package.json',
    target: resolve(cwd, 'package.json'),
  });
  await restoreOptionalFile({
    backupPath: resolvedBackupPath,
    existed: manifest.project.packageLock,
    sourceName: 'package-lock.json',
    target: resolve(cwd, 'package-lock.json'),
  });
  if (manifest.project.aiSettingsKey !== undefined) {
    await restoreOptionalFile({
      backupPath: resolvedBackupPath,
      existed: manifest.project.aiSettingsKey,
      sourceName: 'ai-settings.key',
      target: resolve(cwd, AI_SETTINGS_KEY_RELATIVE_PATH),
    });
  } else {
    output.warn?.('Backup predates AI settings key snapshots; preserving the current .yuncms/ai-settings.key if present.');
  }
  if (allowDifferentDatabaseTarget) {
    output.warn?.('Preserving the current .env because restore targets a different database; the backup .env remains available inside the backup directory.');
  } else {
    await restoreOptionalFile({
      backupPath: resolvedBackupPath,
      existed: manifest.project.env,
      sourceName: '.env',
      target: resolve(cwd, '.env'),
    });
  }

  output.log?.(`Restore completed: ${resolvedBackupPath}`);
  return { backupPath: resolvedBackupPath, manifest };
}

export { AI_SETTINGS_KEY_RELATIVE_PATH, validateBackupManifest };
