import {
  constants as fsConstants,
  access,
  copyFile,
  cp,
  mkdir,
  readFile,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';

import { loadConfig } from '@yunsoft/yuncms-core';

import {
  dumpDatabase,
  restoreDatabase,
  verifyDatabaseDump,
} from './database-backup.js';
import { resetDatabaseObjects } from './database-reset.js';

export const BACKUP_FORMAT_VERSION = 1;

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

async function copyOptionalFile(source, target) {
  const present = await exists(source);
  if (!present) return false;
  await mkdir(dirname(target), { recursive: true, mode: 0o700 });
  await copyFile(source, target);
  return true;
}

async function copyOptionalDirectory(source, target) {
  const present = await exists(source);
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
    [manifest.project?.env, join(backupPath, 'project', '.env')],
    [manifest.project?.packageJson, join(backupPath, 'project', 'package.json')],
    [manifest.project?.packageLock, join(backupPath, 'project', 'package-lock.json')],
    [manifest.project?.extensions, join(backupPath, 'extensions')],
    [manifest.project?.localFiles, join(backupPath, 'files')],
  ];

  for (const [required, path] of expected) {
    if (required && !(await exists(path))) throw missingBackupAsset(path);
  }
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
      const invalid = new Error(`Backup manifest is missing or invalid: ${manifestPath}`);
      invalid.code = 'BACKUP_MANIFEST_INVALID';
      throw invalid;
    }
    throw error;
  }
  if (manifest?.format !== BACKUP_FORMAT_VERSION || manifest?.complete !== true) {
    const error = new Error(`Unsupported or incomplete YunCMS backup: ${manifestPath}`);
    error.code = 'BACKUP_MANIFEST_INVALID';
    throw error;
  }
  if (!(await exists(join(resolved, 'database.sql.gz')))) {
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

  for (const source of [localFilesPath, extensionsPath]) {
    if (await exists(source)) {
      if (pathInside(source, destination)) throw backupPathConflict(source, destination);
    }
  }

  await mkdir(dirname(destination), { recursive: true, mode: 0o700 });
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
    await dumpDatabaseFn({
      config: config.database,
      outputPath: databaseDumpPath,
      env,
    });
    const databaseVerification = await verifyDatabaseFn({ inputPath: databaseDumpPath });

    const envCopied = await copyOptionalFile(resolve(cwd, '.env'), join(destination, 'project', '.env'));
    const packageJsonCopied = await copyOptionalFile(
      resolve(cwd, 'package.json'),
      join(destination, 'project', 'package.json'),
    );
    const packageLockCopied = await copyOptionalFile(
      resolve(cwd, 'package-lock.json'),
      join(destination, 'project', 'package-lock.json'),
    );
    const extensionsCopied = await copyOptionalDirectory(extensionsPath, join(destination, 'extensions'));
    const localFilesCopied = await copyOptionalDirectory(localFilesPath, join(destination, 'files'));

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
        env: envCopied,
        packageJson: packageJsonCopied,
        packageLock: packageLockCopied,
        extensions: extensionsCopied,
        localFiles: localFilesCopied,
        localFilesRoot: config.storage.localRoot,
      },
      s3: {
        configured: Boolean(config.storage.s3.bucket),
        bucket: config.storage.s3.bucket || null,
        objectsBackedUp: false,
      },
    };

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
  await mkdir(dirname(target), { recursive: true });
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

  const databaseDumpPath = join(resolvedBackupPath, 'database.sql.gz');
  output.log?.(`Validating backup before destructive restore: ${resolvedBackupPath}`);
  await verifyDatabaseFn({ inputPath: databaseDumpPath });
  await assertExpectedBackupAssets(resolvedBackupPath, manifest);
  if (beforeDestructive) await beforeDestructive();

  output.log?.(`Resetting database before restore: ${config.database.database}`);
  await resetDatabaseFn({ config: config.database });
  output.log?.(`Restoring database backup: ${resolvedBackupPath}`);
  await restoreDatabaseFn({
    config: config.database,
    inputPath: databaseDumpPath,
    env,
  });

  const localFilesPath = resolveProjectPath(cwd, config.storage.localRoot);
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
    target: resolve(cwd, 'extensions'),
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
  await restoreOptionalFile({
    backupPath: resolvedBackupPath,
    existed: manifest.project.env,
    sourceName: '.env',
    target: resolve(cwd, '.env'),
  });

  output.log?.(`Restore completed: ${resolvedBackupPath}`);
  return { backupPath: resolvedBackupPath, manifest };
}
