import { BaseService } from './base-service.js';

const DEFAULT_MIN_AGE_MS = 60 * 60 * 1000;
const MIN_SAFE_AGE_MS = 60 * 1000;
const MAX_INVENTORY_OBJECTS = 100_000;

function serviceError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function assertFileManager(accountability) {
  if (accountability?.admin === true || accountability?.system === true) return;
  throw serviceError('FORBIDDEN', 'Storage reconciliation requires administrator accountability');
}

function normalizeAge(value) {
  const age = value ?? DEFAULT_MIN_AGE_MS;
  if (!Number.isInteger(age) || age < MIN_SAFE_AGE_MS || age > 30 * 24 * 60 * 60 * 1000) {
    throw serviceError(
      'INVALID_PAYLOAD',
      'Storage orphan minimum age must be between 1 minute and 30 days',
    );
  }
  return age;
}

function objectAgeMs(object, nowMs) {
  if (!object?.modifiedAt) return null;
  const modifiedMs = new Date(object.modifiedAt).getTime();
  if (!Number.isFinite(modifiedMs)) return null;
  return Math.max(0, nowMs - modifiedMs);
}

export class FileReconciliationService extends BaseService {
  constructor(options = {}) {
    super(options);
    if (!options.storage) throw new Error('FileReconciliationService requires a storage registry');
    this.storage = options.storage;
  }

  async scan({
    storage = 'local',
    deleteOrphans = false,
    minimumAgeMs = DEFAULT_MIN_AGE_MS,
  } = {}) {
    assertFileManager(this.accountability);
    const ageGuardMs = normalizeAge(minimumAgeMs);
    const driver = this.storage.get(storage);
    if (typeof driver.list !== 'function') {
      throw serviceError(
        'STORAGE_INVENTORY_UNSUPPORTED',
        `Storage driver ${storage} does not support inventory listing`,
      );
    }

    const [rows] = await this.database.query(
      `SELECT id, filename_disk, filename_download, filesize, uploaded_at
       FROM yuncms_files
       WHERE storage = ?
       ORDER BY uploaded_at ASC, id ASC`,
      [storage],
    );
    const objects = await driver.list();
    if (objects.length > MAX_INVENTORY_OBJECTS) {
      throw serviceError(
        'STORAGE_INVENTORY_LIMIT',
        `Storage inventory exceeds the V1 safety limit of ${MAX_INVENTORY_OBJECTS} objects`,
      );
    }

    const metadataByKey = new Map(rows.map((row) => [row.filename_disk, row]));
    const objectByKey = new Map(objects.map((object) => [object.key, object]));
    const missingObjects = rows
      .filter((row) => !objectByKey.has(row.filename_disk))
      .map((row) => ({
        id: row.id,
        key: row.filename_disk,
        filename: row.filename_download,
        expectedSize: Number(row.filesize ?? 0),
        uploadedAt: row.uploaded_at,
      }));

    const nowMs = Date.now();
    const orphanObjects = objects
      .filter((object) => !metadataByKey.has(object.key))
      .map((object) => {
        const ageMs = objectAgeMs(object, nowMs);
        return {
          key: object.key,
          size: Number(object.size ?? 0),
          modifiedAt: object.modifiedAt ?? null,
          ageMs,
          eligibleForDelete: ageMs !== null && ageMs >= ageGuardMs,
        };
      });

    const deletedOrphans = [];
    if (deleteOrphans === true) {
      for (const orphan of orphanObjects) {
        if (!orphan.eligibleForDelete) continue;
        await driver.delete(orphan.key);
        deletedOrphans.push(orphan.key);
      }
    }

    return {
      storage,
      minimumAgeMs: ageGuardMs,
      deleteOrphans: deleteOrphans === true,
      metadataCount: rows.length,
      storageObjectCount: objects.length,
      missingObjects,
      orphanObjects,
      deletedOrphans,
    };
  }
}

export {
  DEFAULT_MIN_AGE_MS,
  MAX_INVENTORY_OBJECTS,
  MIN_SAFE_AGE_MS,
  normalizeAge,
  objectAgeMs,
};
