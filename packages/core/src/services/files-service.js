import { randomUUID } from 'node:crypto';

import { compileFilter } from '../query.js';
import { BaseService } from './base-service.js';
import { resolveSystemResourceAccess } from './system-resource-access.js';

function fileError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function normalizeFilename(value) {
  if (typeof value !== 'string') throw fileError('INVALID_PAYLOAD', 'Download filename is required');
  const filename = value.trim();
  if (!filename || filename.length > 255 || /[\u0000-\u001f\u007f]/.test(filename)) {
    throw fileError('INVALID_PAYLOAD', 'Download filename is invalid');
  }
  return filename;
}

function normalizeMimeType(value) {
  if (value == null || value === '') return 'application/octet-stream';
  const mimetype = String(value).trim().toLowerCase();
  if (!mimetype || mimetype.length > 191 || !/^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+$/.test(mimetype)) {
    throw fileError('INVALID_PAYLOAD', 'File MIME type is invalid');
  }
  return mimetype;
}

function startsWithBytes(buffer, bytes, offset = 0) {
  if (buffer.byteLength < offset + bytes.length) return false;
  return bytes.every((byte, index) => buffer[offset + index] === byte);
}

function hasKnownMimeSignature(contents, mimetype) {
  const buffer = Buffer.isBuffer(contents) ? contents : Buffer.from(contents);
  switch (mimetype) {
    case 'application/pdf':
      return startsWithBytes(buffer, [0x25, 0x50, 0x44, 0x46, 0x2d]);
    case 'image/png':
      return startsWithBytes(buffer, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    case 'image/jpeg':
      return startsWithBytes(buffer, [0xff, 0xd8, 0xff]);
    case 'image/gif':
      return buffer.subarray(0, 6).toString('ascii') === 'GIF87a'
        || buffer.subarray(0, 6).toString('ascii') === 'GIF89a';
    case 'image/webp':
      return buffer.subarray(0, 4).toString('ascii') === 'RIFF'
        && buffer.subarray(8, 12).toString('ascii') === 'WEBP';
    default:
      return null;
  }
}

function assertMimeSignature(contents, mimetype) {
  const matches = hasKnownMimeSignature(contents, mimetype);
  if (matches === false) {
    throw fileError('FILE_MIME_MISMATCH', `File contents do not match declared MIME type: ${mimetype}`);
  }
}

function decodeJson(value) {
  if (value == null || typeof value === 'object') return value ?? null;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function normalizeRow(row) {
  return row ? { ...row, metadata: decodeJson(row.metadata) } : null;
}

export class FilesService extends BaseService {
  constructor(options = {}) {
    super(options);
    if (!options.storage) throw new Error('FilesService requires a storage registry');
    this.storage = options.storage;
  }

  async action(event, payload) {
    if (!this.emitter) return;
    await this.emitter.action(event, payload, {
      accountability: this.accountability,
      requestId: this.requestId,
      collection: 'yuncms_files',
    });
  }

  #compileReadScope(permission, id = null) {
    let sql = '';
    let params = [];

    if (permission?.filter) {
      const collectionSchema = this.schema?.collections?.yuncms_files;
      if (!collectionSchema) {
        throw fileError(
          'SYSTEM_SCHEMA_REQUIRED',
          'System schema is required to enforce a filtered Files permission',
        );
      }
      const compiled = compileFilter(permission.filter, collectionSchema);
      sql = compiled.sql;
      params = [...compiled.params];
    }

    if (id != null) {
      sql = sql ? `${sql} AND id = ?` : ' WHERE id = ?';
      params.push(id);
    }

    return { sql, params };
  }

  async #readOneUnsafe(id) {
    const [rows] = await this.database.query(
      `SELECT id, storage, filename_disk, filename_download, title, mimetype, filesize,
              uploaded_by, uploaded_at, metadata
       FROM yuncms_files
       WHERE id = ?
       LIMIT 1`,
      [id],
    );
    return normalizeRow(rows[0]);
  }

  async #readOneAuthorized(id, permission) {
    const scope = this.#compileReadScope(permission, id);
    const [rows] = await this.database.query(
      `SELECT id, storage, filename_disk, filename_download, title, mimetype, filesize,
              uploaded_by, uploaded_at, metadata
       FROM yuncms_files${scope.sql}
       LIMIT 1`,
      scope.params,
    );
    return normalizeRow(rows[0]);
  }

  async readMany() {
    const permission = await resolveSystemResourceAccess(this, 'read', 'yuncms_files');
    const scope = this.#compileReadScope(permission);
    const [rows] = await this.database.query(
      `SELECT id, storage, filename_disk, filename_download, title, mimetype, filesize,
              uploaded_by, uploaded_at, metadata
       FROM yuncms_files${scope.sql}
       ORDER BY uploaded_at DESC, id DESC`,
      scope.params,
    );
    return rows.map(normalizeRow);
  }

  async readOne(id) {
    const permission = await resolveSystemResourceAccess(this, 'read', 'yuncms_files');
    return this.#readOneAuthorized(id, permission);
  }

  async createOne({
    contents,
    filenameDownload,
    title = null,
    mimetype = 'application/octet-stream',
    storage = 'local',
    metadata = null,
  } = {}) {
    await resolveSystemResourceAccess(this, 'create', 'yuncms_files');
    if (!Buffer.isBuffer(contents) && !(contents instanceof Uint8Array)) {
      throw fileError('INVALID_FILE_CONTENT', 'File contents must be Buffer or Uint8Array');
    }
    if (contents.byteLength === 0) throw fileError('INVALID_FILE_CONTENT', 'Empty file uploads are not allowed');

    const filename = normalizeFilename(filenameDownload);
    const normalizedMime = normalizeMimeType(mimetype);
    assertMimeSignature(contents, normalizedMime);
    const driver = this.storage.get(storage);
    const id = randomUUID();
    const filenameDisk = id;
    let stored = false;

    try {
      await driver.put(filenameDisk, contents);
      stored = true;
      await this.database.query(
        `INSERT INTO yuncms_files
         (id, storage, filename_disk, filename_download, title, mimetype, filesize, uploaded_by, metadata)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          id,
          storage,
          filenameDisk,
          filename,
          title == null ? null : String(title).slice(0, 255),
          normalizedMime,
          contents.byteLength,
          this.accountability.user ?? null,
          metadata == null ? null : JSON.stringify(metadata),
        ],
      );
      const file = await this.#readOneUnsafe(id);
      await this.action('files.create', {
        key: id,
        item: file,
      });
      return file;
    } catch (error) {
      if (stored) {
        try {
          await driver.delete(filenameDisk);
        } catch (cleanupError) {
          error.cleanupError = cleanupError;
          error.code ||= 'FILE_STORAGE_CLEANUP_FAILED';
        }
      }
      throw error;
    }
  }

  async readContent(id) {
    const permission = await resolveSystemResourceAccess(this, 'read', 'yuncms_files');
    const file = await this.#readOneAuthorized(id, permission);
    if (!file) throw fileError('FILE_NOT_FOUND', `Unknown file: ${id}`);
    const driver = this.storage.get(file.storage);
    const contents = await driver.get(file.filename_disk);
    return { file, contents };
  }

  async updateOne(id, patch = {}) {
    await resolveSystemResourceAccess(this, 'update', 'yuncms_files');
    if (!patch || typeof patch !== 'object' || Array.isArray(patch)) {
      throw fileError('INVALID_PAYLOAD', 'File metadata patch must be an object');
    }
    const keys = Object.keys(patch);
    if (keys.length === 0 || keys.some((key) => !['filenameDownload', 'title', 'metadata'].includes(key))) {
      throw fileError('INVALID_PAYLOAD', 'File update supports filenameDownload, title and metadata only');
    }

    const before = await this.#readOneUnsafe(id);
    if (!before) throw fileError('FILE_NOT_FOUND', `Unknown file: ${id}`);

    const assignments = [];
    const params = [];
    if (Object.hasOwn(patch, 'filenameDownload')) {
      assignments.push('filename_download = ?');
      params.push(normalizeFilename(patch.filenameDownload));
    }
    if (Object.hasOwn(patch, 'title')) {
      assignments.push('title = ?');
      params.push(patch.title == null ? null : String(patch.title).slice(0, 255));
    }
    if (Object.hasOwn(patch, 'metadata')) {
      assignments.push('metadata = ?');
      params.push(patch.metadata == null ? null : JSON.stringify(patch.metadata));
    }

    params.push(id);
    const [result] = await this.database.query(
      `UPDATE yuncms_files SET ${assignments.join(', ')} WHERE id = ?`,
      params,
    );
    if (result.affectedRows !== 1) throw fileError('FILE_NOT_FOUND', `Unknown file: ${id}`);
    const file = await this.#readOneUnsafe(id);
    await this.action('files.update', {
      key: id,
      before,
      item: file,
      changes: patch,
    });
    return file;
  }

  async deleteOne(id) {
    await resolveSystemResourceAccess(this, 'delete', 'yuncms_files');
    const file = await this.#readOneUnsafe(id);
    if (!file) throw fileError('FILE_NOT_FOUND', `Unknown file: ${id}`);

    const [result] = await this.database.query('DELETE FROM yuncms_files WHERE id = ?', [id]);
    if (result.affectedRows !== 1) throw fileError('FILE_NOT_FOUND', `Unknown file: ${id}`);

    const driver = this.storage.get(file.storage);
    try {
      await driver.delete(file.filename_disk);
    } catch (cleanupError) {
      const error = fileError(
        'FILE_STORAGE_CLEANUP_FAILED',
        'File metadata was deleted but the storage object could not be removed',
      );
      error.cleanupError = cleanupError;
      error.file = file;
      throw error;
    }

    await this.action('files.delete', {
      key: id,
      before: file,
    });
    return true;
  }
}

export {
  assertMimeSignature,
  hasKnownMimeSignature,
  normalizeFilename,
  normalizeMimeType,
};
