import { mkdir, readFile, readdir, stat, unlink, writeFile } from 'node:fs/promises';
import { isAbsolute, relative, resolve } from 'node:path';

const STORAGE_KEY = /^[A-Za-z0-9][A-Za-z0-9._-]{0,190}$/;

function storageError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function assertStorageKey(key) {
  if (typeof key !== 'string' || !STORAGE_KEY.test(key) || key.includes('..')) {
    throw storageError('INVALID_STORAGE_KEY', 'Storage key contains unsupported path characters');
  }
  return key;
}

export class LocalStorageDriver {
  constructor({ root }) {
    if (!root || typeof root !== 'string') throw new Error('Local storage root is required');
    this.root = resolve(root);
  }

  pathFor(key) {
    const safeKey = assertStorageKey(key);
    const path = resolve(this.root, safeKey);
    const fromRoot = relative(this.root, path);
    if (!fromRoot || fromRoot.startsWith('..') || isAbsolute(fromRoot)) {
      throw storageError('INVALID_STORAGE_KEY', 'Storage key escaped the configured root');
    }
    return path;
  }

  async put(key, contents) {
    const path = this.pathFor(key);
    if (!Buffer.isBuffer(contents) && !(contents instanceof Uint8Array)) {
      throw storageError('INVALID_FILE_CONTENT', 'Local storage put requires Buffer or Uint8Array content');
    }
    await mkdir(this.root, { recursive: true });
    await writeFile(path, contents, { flag: 'wx' });
    return { key, size: contents.byteLength };
  }

  async get(key) {
    return readFile(this.pathFor(key));
  }

  async stat(key) {
    try {
      const info = await stat(this.pathFor(key));
      return {
        key,
        size: info.size,
        modifiedAt: info.mtime,
      };
    } catch (error) {
      if (error?.code === 'ENOENT') return null;
      throw error;
    }
  }

  async list() {
    let entries;
    try {
      entries = await readdir(this.root, { withFileTypes: true });
    } catch (error) {
      if (error?.code === 'ENOENT') return [];
      throw error;
    }

    const objects = [];
    for (const entry of entries) {
      if (!entry.isFile()) continue;
      try {
        const key = assertStorageKey(entry.name);
        const info = await stat(this.pathFor(key));
        objects.push({
          key,
          size: info.size,
          modifiedAt: info.mtime,
        });
      } catch (error) {
        if (error?.code !== 'INVALID_STORAGE_KEY') throw error;
      }
    }
    return objects;
  }

  async delete(key) {
    try {
      await unlink(this.pathFor(key));
      return true;
    } catch (error) {
      if (error?.code === 'ENOENT') return false;
      throw error;
    }
  }

  async getSignedUrl() {
    return null;
  }
}

export { assertStorageKey };
