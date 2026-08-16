import { withAdvisoryLock } from '../advisory-lock.js';
import { assertIdentifier, quoteIdentifier } from '../identifier.js';
import { SchemaMetadataRepository } from '../schema-metadata-repository.js';
import { incrementSchemaVersion } from '../schema-version.js';
import { withConnectionTransaction } from '../transaction.js';
import { BaseService } from './base-service.js';

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
}
