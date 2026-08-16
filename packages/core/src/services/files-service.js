import { randomUUID } from 'node:crypto';

import { BaseService } from './base-service.js';

function fileError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function assertFileManager(accountability) {
  if (accountability.admin === true || accountability.system === true) return;
  throw fileError('FORBIDDEN', 'File management requires administrator accountability in V1');
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

  async readMany() {
    assertFileManager(this.accountability);
    const [rows] = await this.database.query(
      `SELECT id, storage, filename_disk, filename_download, title, mimetype, filesize,
              uploaded_by, uploaded_at, metadata
       FROM yuncms_files
       ORDER BY uploaded_at DESC, id DESC`,
    );
    return rows.map(normalizeRow);
  }

  async readOne(id) {
    assertFileManager(this.accountability);
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

  async createOne({
    contents,
    filenameDownload,
    title = null,
    mimetype = 'application/octet-stream',
    storage = 'local',
    metadata = null,
  } = {}) {
    assertFileManager(this.accountability);
    if (!Buffer.isBuffer(contents) && !(contents instanceof Uint8Array)) {
      throw fileError('INVALID_FILE_CONTENT', 'File contents must be Buffer or Uint8Array');
    }
    if (contents.byteLength === 0) throw fileError('INVALID_FILE_CONTENT', 'Empty file uploads are not allowed');

    const filename = normalizeFilename(filenameDownload);
    const normalizedMime = normalizeMimeType(mimetype);
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
      const file = await this.readOne(id);
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
    const file = await this.readOne(id);
    if (!file) throw fileError('FILE_NOT_FOUND', `Unknown file: ${id}`);
    const driver = this.storage.get(file.storage);
    const contents = await driver.get(file.filename_disk);
    return { file, contents };
  }

  async updateOne(id, patch = {}) {
    assertFileManager(this.accountability);
    if (!patch || typeof patch !== 'object' || Array.isArray(patch)) {
      throw fileError('INVALID_PAYLOAD', 'File metadata patch must be an object');
    }
    const keys = Object.keys(patch);
    if (keys.length === 0 || keys.some((key) => !['filenameDownload', 'title', 'metadata'].includes(key))) {
      throw fileError('INVALID_PAYLOAD', 'File update supports filenameDownload, title and metadata only');
    }

    const before = await this.readOne(id);
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
    const file = await this.readOne(id);
    await this.action('files.update', {
      key: id,
      before,
      item: file,
      changes: patch,
    });
    return file;
  }

  async deleteOne(id) {
    assertFileManager(this.accountability);
    const file = await this.readOne(id);
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

export { normalizeFilename, normalizeMimeType };
