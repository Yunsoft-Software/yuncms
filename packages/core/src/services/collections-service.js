import { randomUUID } from 'node:crypto';

import { withAdvisoryLock } from '../advisory-lock.js';
import { assertIdentifier, quoteIdentifier } from '../identifier.js';
import { SchemaMetadataRepository } from '../schema-metadata-repository.js';
import { normalizeDisplayName, resolveSchemaName } from '../schema-key.js';
import { incrementSchemaVersion } from '../schema-version.js';
import { compileCollectionSystemFields, normalizeCollectionSystemFields } from '../system-fields.js';
import { withConnectionTransaction } from '../transaction.js';
import { BaseService } from './base-service.js';
import { assertSchemaManager } from './schema-access.js';

const COLLECTION_METADATA_KEYS = new Set(['name', 'note', 'singleton', 'hidden', 'metadata']);

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

function invalidSchemaPayload(message) {
  const error = new Error(message);
  error.code = 'INVALID_SCHEMA_PAYLOAD';
  return error;
}

function assertCollectionMetadataPatch(patch) {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) {
    throw invalidSchemaPayload('Collection metadata patch must be an object');
  }
  for (const key of Object.keys(patch)) {
    if (!COLLECTION_METADATA_KEYS.has(key)) {
      const error = new Error(`Collection property cannot be updated in V1: ${key}`);
      error.code = 'UNSUPPORTED_SCHEMA_UPDATE';
      throw error;
    }
  }
  if (Object.keys(patch).length === 0) {
    throw invalidSchemaPayload('Collection metadata patch cannot be empty');
  }
  for (const key of ['singleton', 'hidden']) {
    if (Object.hasOwn(patch, key) && typeof patch[key] !== 'boolean') {
      throw invalidSchemaPayload(`Collection ${key} must be a boolean`);
    }
  }
  if (Object.hasOwn(patch, 'name')) {
    patch.name = normalizeDisplayName(patch.name);
  }
  if (Object.hasOwn(patch, 'note') && patch.note != null && typeof patch.note !== 'string') {
    throw invalidSchemaPayload('Collection note must be a string or null');
  }
  if (Object.hasOwn(patch, 'metadata') && patch.metadata != null && (
    typeof patch.metadata !== 'object' || Array.isArray(patch.metadata)
  )) {
    throw invalidSchemaPayload('Collection metadata must be an object or null');
  }
}

function assertCollectionCreateMetadata(input) {
  for (const key of ['singleton', 'hidden']) {
    if (Object.hasOwn(input, key) && typeof input[key] !== 'boolean') {
      throw invalidSchemaPayload(`Collection ${key} must be a boolean`);
    }
  }
  if (Object.hasOwn(input, 'note') && input.note != null && typeof input.note !== 'string') {
    throw invalidSchemaPayload('Collection note must be a string or null');
  }
  if (Object.hasOwn(input, 'metadata') && input.metadata != null && (
    typeof input.metadata !== 'object' || Array.isArray(input.metadata)
  )) {
    throw invalidSchemaPayload('Collection metadata must be an object or null');
  }
  normalizeCollectionSystemFields(input.systemFields);
}

function temporaryDropName() {
  return `_yuncms_drop_${randomUUID().replaceAll('-', '').slice(0, 24)}`;
}

export class CollectionsService extends BaseService {
  async readMany() {
    assertSchemaManager(this.accountability);
    return new SchemaMetadataRepository(this.database).listCollections();
  }

  async readOne(collection) {
    assertSchemaManager(this.accountability);
    assertIdentifier(collection, 'collection name');
    return new SchemaMetadataRepository(this.database).readCollection(collection);
  }

  async createOne(input = {}) {
    assertSchemaManager(this.accountability);
    assertCollectionCreateMetadata(input);
    const resolvedName = resolveSchemaName({
      displayName: input.name ?? input.collection,
      key: input.collection,
      prefix: 'collection',
    });
    const collection = assertUserCollectionName(resolvedName.key);
    const name = resolvedName.name;
    const primaryKey = input.primaryKey ?? 'id';

    if (primaryKey !== 'id') {
      const error = new Error('V1 collection creation currently requires the primary key field to be named id');
      error.code = 'UNSUPPORTED_PRIMARY_KEY';
      throw error;
    }

    const systemFields = compileCollectionSystemFields(collection, input.systemFields);

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
      const physicalDefinitions = [
        'id CHAR(36) NOT NULL PRIMARY KEY',
        ...systemFields.columns,
        ...systemFields.constraints,
      ];

      try {
        await connection.query(
          `CREATE TABLE ${table} (
            ${physicalDefinitions.join(',\n            ')}
          ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
        );
        tableCreated = true;

        return await withConnectionTransaction(connection, async () => {
          const created = await metadata.createCollection({
            collection,
            name,
            primaryKey,
            note: input.note ?? null,
            singleton: input.singleton === true,
            hidden: input.hidden === true,
            metadata: {
              ...(input.metadata ?? {}),
              systemFields: systemFields.fields,
            },
          });

          await metadata.createField({
            collection,
            field: 'id',
            name: 'ID',
            type: 'uuid',
            required: true,
            readonly: true,
            interface: 'input',
            schemaMetadata: { primaryKey: true, length: 36 },
          });

          for (const systemField of systemFields.metadata) {
            await metadata.createField(systemField);
          }

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
    assertSchemaManager(this.accountability);
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

  async deleteOne(collection, { destructive = false } = {}) {
    assertSchemaManager(this.accountability);
    assertIdentifier(collection, 'collection name');
    if (destructive !== true) {
      const error = new Error('Collection deletion requires destructive: true');
      error.code = 'DESTRUCTIVE_OPERATION_REQUIRED';
      throw error;
    }

    return withAdvisoryLock(this.database, 'yuncms:schema', async (connection) => {
      const metadata = new SchemaMetadataRepository(connection);
      const existing = await metadata.readCollection(collection);
      if (!existing) {
        const error = new Error(`Unknown collection: ${collection}`);
        error.code = 'COLLECTION_NOT_FOUND';
        throw error;
      }
      if (existing.system) {
        const error = new Error('System collections cannot be deleted through the dynamic schema API');
        error.code = 'SYSTEM_SCHEMA_READ_ONLY';
        throw error;
      }

      const relations = await metadata.listRelations();
      const blockingRelations = relations.filter((relation) =>
        relation.many_collection === collection ||
        relation.one_collection === collection ||
        relation.junction_collection === collection);
      if (blockingRelations.length > 0) {
        const error = new Error(`Collection has relations and cannot be deleted: ${collection}`);
        error.code = 'COLLECTION_HAS_RELATIONS';
        error.relations = blockingRelations.map((relation) => ({
          many_collection: relation.many_collection,
          many_field: relation.many_field,
          one_collection: relation.one_collection,
        }));
        throw error;
      }

      const originalTable = quoteIdentifier(collection, 'collection name');
      const tombstoneName = temporaryDropName();
      const tombstoneTable = quoteIdentifier(tombstoneName, 'temporary collection name');

      await connection.query(`RENAME TABLE ${originalTable} TO ${tombstoneTable}`);

      let result;
      try {
        result = await withConnectionTransaction(connection, async () => {
          await connection.query('DELETE FROM yuncms_permissions WHERE collection = ?', [collection]);
          const deleted = await metadata.deleteCollection(collection);
          if (deleted !== 1) {
            const error = new Error(`Collection metadata disappeared during delete: ${collection}`);
            error.code = 'SCHEMA_METADATA_DRIFT';
            throw error;
          }
          const schemaVersion = await incrementSchemaVersion(connection);
          return { deleted: true, collection, schemaVersion };
        });
      } catch (error) {
        try {
          await connection.query(`RENAME TABLE ${tombstoneTable} TO ${originalTable}`);
        } catch (restoreError) {
          error.restoreError = restoreError;
          error.code ||= 'SCHEMA_PARTIAL_FAILURE';
        }
        throw error;
      }

      try {
        await connection.query(`DROP TABLE ${tombstoneTable}`);
      } catch (cleanupError) {
        const error = new Error(`Collection was logically deleted but physical cleanup failed: ${collection}`);
        error.code = 'SCHEMA_PARTIAL_FAILURE';
        error.cleanupError = cleanupError;
        error.cleanupTable = tombstoneName;
        error.logicalDelete = result;
        throw error;
      }

      return result;
    });
  }
}
