import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { lstat, readdir } from 'node:fs/promises';
import { relative, resolve, sep } from 'node:path';

function backupError(code, message, details = {}) {
  const error = new Error(message);
  error.code = code;
  Object.assign(error, details);
  return error;
}

async function pathInfo(path, { optional = false, kind = null } = {}) {
  let info;
  try {
    info = await lstat(path);
  } catch (error) {
    if (optional && error?.code === 'ENOENT') return null;
    throw error;
  }

  if (info.isSymbolicLink()) {
    throw backupError(
      'BACKUP_SYMLINK_UNSUPPORTED',
      `Managed backup/restore does not support symbolic links: ${path}`,
      { path },
    );
  }

  if (kind === 'file' && !info.isFile()) {
    throw backupError('BACKUP_ASSET_TYPE_INVALID', `Expected a regular file: ${path}`, { path, kind });
  }
  if (kind === 'directory' && !info.isDirectory()) {
    throw backupError('BACKUP_ASSET_TYPE_INVALID', `Expected a directory: ${path}`, { path, kind });
  }
  if (!info.isFile() && !info.isDirectory()) {
    throw backupError('BACKUP_ASSET_TYPE_INVALID', `Unsupported backup asset type: ${path}`, { path, kind });
  }

  return info;
}

async function updateHashWithFile(hash, path) {
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  hash.update('\0END\0');
}

export async function assertBackupAssetType(path, kind, { optional = false } = {}) {
  const info = await pathInfo(path, { optional, kind });
  return info !== null;
}

export async function hashFile(path) {
  await pathInfo(path, { kind: 'file' });
  const hash = createHash('sha256');
  hash.update('YunCMS:file:v1\0');
  await updateHashWithFile(hash, path);
  return hash.digest('hex');
}

function compareEntryNames(left, right) {
  if (left.name < right.name) return -1;
  if (left.name > right.name) return 1;
  return 0;
}

async function hashDirectoryEntry(root, path, hash) {
  const info = await pathInfo(path);
  const relativePath = relative(root, path).split(sep).join('/');

  if (info.isDirectory()) {
    hash.update(`D\0${relativePath}\0`);
    const entries = await readdir(path, { withFileTypes: true });
    entries.sort(compareEntryNames);
    for (const entry of entries) {
      await hashDirectoryEntry(root, resolve(path, entry.name), hash);
    }
    return;
  }

  hash.update(`F\0${relativePath}\0${info.size}\0`);
  await updateHashWithFile(hash, path);
}

export async function hashDirectory(path) {
  await pathInfo(path, { kind: 'directory' });
  const root = resolve(path);
  const hash = createHash('sha256');
  hash.update('YunCMS:directory:v1\0');
  await hashDirectoryEntry(root, root, hash);
  return hash.digest('hex');
}

export async function hashOptionalAsset(path, kind) {
  const present = await assertBackupAssetType(path, kind, { optional: true });
  if (!present) return null;
  return kind === 'directory' ? hashDirectory(path) : hashFile(path);
}

export async function verifyAssetDigest(path, kind, expectedDigest) {
  if (typeof expectedDigest !== 'string' || !/^[0-9a-f]{64}$/i.test(expectedDigest)) {
    throw backupError(
      'BACKUP_MANIFEST_INVALID',
      `Backup manifest contains an invalid SHA-256 digest for ${path}`,
      { path },
    );
  }

  const actualDigest = kind === 'directory' ? await hashDirectory(path) : await hashFile(path);
  if (actualDigest.toLowerCase() !== expectedDigest.toLowerCase()) {
    throw backupError(
      'BACKUP_INTEGRITY_MISMATCH',
      `Backup integrity check failed for ${path}`,
      { path, expectedDigest, actualDigest },
    );
  }
  return true;
}
