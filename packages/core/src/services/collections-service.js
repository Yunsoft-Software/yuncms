import { withAdvisoryLock } from '../advisory-lock.js';
import { assertIdentifier, quoteIdentifier } from '../identifier.js';
import { SchemaMetadataRepository } from '../schema-metadata-repository.js';
import { incrementSchemaVersion } from '../schema-version.js';
import { withConnectionTransaction } from '../transaction.js';
import { BaseService } from './base-service.js';

const COLLECTION_METADATA_KEYS = new Set(['note', 'singleton', 'hidden', 'metadata']);

function assertUserCollectionName(collection) {
  assertIdentifier(collection, 'collection name');
  if (collection.length > 64) throw new Error('Collection name cannot exceed 64 characters');
  if (collection.toLowerCase().startsWith('yuncms_')) {
    const error = new Error('The yuncms_ prefix is reserved for system tables');
    error.code = 'RESERVED_COLLECTION_NAME';
    throw error;
  }
  return collection;
}

function assertCollectionMetadataPatch(patch) {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) {
    const error = new Error('Collection metadata patch must be an object');
    error.code = 'INVALID_SCHEMA_PAYLOAD';
    throw error;
  }
  for (const key of Object.keys(patch)) {
    if (!COLLECTION_METADATA_KEYS.has(key)) {
      const error = new Error(`Collection property cannot be updated in V1: ${key}`);
      error.code = 'UNSUPPORTED_SCHEMA_UPDATE';
      throw error;
    }
  }
  if (Object.keys(patch).length === 0) {
    const error = new Error('Collection metadata patch cannot be empty');
    error.code = 'INVALID_SCHEMA_PAYLOAD';
    throw error;
  }
}

export class CollectionsService extends BaseService {
  async readMany() {
    return new SchemaMetadataRepository(this.database).listCollections();
  }

  async readOne(collection) {
    assertIdentifier(collection, 'collection name');
    return new SchemaMetadataRepository(this.database).readCollection(collection);
  }

  async createOne(input = {}) {
    const collection = assertUserCollectionName(input.collection);
    const primaryKey = input.primaryKey ?? 'id';

    if (primaryKey !== 'id') {
      const error = new Error('V1 collection creation currently requires the primary key field to be named id');
      error.code = 'UNSUPPORTED_PRIMARY_KEY';
      throw error;
    }

    return withAdvisoryLock(this.database, 'yuncms:schema', async (connection) => {
      const metadata = new SchemaMetadataRepository(connection);
      const existing = await metadata.readCollection(collection);
      if (existing) {
        const error = new Error(`Collection already exists: ${collection}`);
        error.code = 'COLLECTION_EXISTS';
        throw error;
      }

      const table = quoteIdentifier(collection, 'collection name');
      let tableCreated = false;

      try {
        await connection.query(
          `CREATE TABLE ${table} (
            id CHAR(36) NOT NULL PRIMARY KEY
          ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
        );
        tableCreated = true;

        return await withConnectionTransaction(connection, async () => {
          const created = await metadata.createCollection({
            collection,
            primaryKey,
            note: input.note ?? null,
            singleton: input.singleton === true,
            hidden: input.hidden === true,
            metadata: input.metadata ?? null,
          });

          await metadata.createField({
            collection,
            field: 'id',
            type: 'uuid',
            required: true,
            readonly: true,
            interface: 'input',
            schemaMetadata: { primaryKey: true, length: 36 },
          });

          const schemaVersion = await incrementSchemaVersion(connection);
          return { ...created, schemaVersion };
        });
      } catch (error) {
        const cleanupErrors = [];

        try {
          await metadata.deleteCollection(collection);
        } catch (cleanupError) {
          cleanupErrors.push(cleanupError);
        }

        if (tableCreated) {
          try {
            await connection.query(`DROP TABLE IF EXISTS ${table}`);
          } catch (cleanupError) {
            cleanupErrors.push(cleanupError);
          }
        }

        if (cleanupErrors.length > 0) {
          error.cleanupErrors = cleanupErrors;
          error.code ||= 'SCHEMA_PARTIAL_FAILURE';
        }
        throw error;
      }
    });
  }

  async updateOne(collection, patch) {
    assertIdentifier(collection, 'collection name');
    assertCollectionMetadataPatch(patch);

    return withAdvisoryLock(this.database, 'yuncms:schema', async (connection) => {
      const metadata = new SchemaMetadataRepository(connection);
      const existing = await metadata.readCollection(collection);
      if (!existing) {
        const error = new Error(`Unknown collection: ${collection}`);
        error.code = 'COLLECTION_NOT_FOUND';
        throw error;
      }
      if (existing.system) {
        const error = new Error('System collection metadata cannot be changed through the dynamic schema API');
        error.code = 'SYSTEM_SCHEMA_READ_ONLY';
        throw error;
      }

      return withConnectionTransaction(connection, async () => {
        const updated = await metadata.updateCollectionMetadata(collection, patch);
        const schemaVersion = await incrementSchemaVersion(connection);
        return { ...updated, schemaVersion };
      });
    });
  }
}
