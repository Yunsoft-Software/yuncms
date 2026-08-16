import { randomUUID } from 'node:crypto';

import { withAdvisoryLock } from '../advisory-lock.js';
import { compileFieldColumn } from '../field-types.js';
import { assertIdentifier, quoteIdentifier } from '../identifier.js';
import { SchemaMetadataRepository } from '../schema-metadata-repository.js';
import { incrementSchemaVersion } from '../schema-version.js';
import { withConnectionTransaction } from '../transaction.js';
import { BaseService } from './base-service.js';
import { assertSchemaManager } from './schema-access.js';

const FIELD_METADATA_KEYS = new Set(['readonly', 'hidden', 'sort', 'interface', 'options']);

function assertFieldName(field) {
  assertIdentifier(field, 'field name');
  if (field.length > 64) throw new Error('Field name cannot exceed 64 characters');
  return field;
}

function assertFieldMetadataPatch(patch) {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) {
    const error = new Error('Field metadata patch must be an object');
    error.code = 'INVALID_SCHEMA_PAYLOAD';
    throw error;
  }
  for (const key of Object.keys(patch)) {
    if (!FIELD_METADATA_KEYS.has(key)) {
      const error = new Error(`Field property cannot be updated through metadata-only V1 update: ${key}`);
      error.code = 'UNSUPPORTED_SCHEMA_UPDATE';
      throw error;
    }
  }
  if (Object.keys(patch).length === 0) {
    const error = new Error('Field metadata patch cannot be empty');
    error.code = 'INVALID_SCHEMA_PAYLOAD';
    throw error;
  }
}

function temporaryDropName() {
  return `_yuncms_drop_${randomUUID().replaceAll('-', '').slice(0, 24)}`;
}

export class FieldsService extends BaseService {
  async readMany(collection) {
    assertSchemaManager(this.accountability);
    assertIdentifier(collection, 'collection name');
    return new SchemaMetadataRepository(this.database).listFields(collection);
  }

  async readOne(collection, field) {
    assertSchemaManager(this.accountability);
    assertIdentifier(collection, 'collection name');
    assertFieldName(field);
    return new SchemaMetadataRepository(this.database).readField(collection, field);
  }

  async createOne(collection, input = {}) {
    assertSchemaManager(this.accountability);
    assertIdentifier(collection, 'collection name');
    const field = assertFieldName(input.field);

    if (field === 'id') {
      const error = new Error('The id field is created with the collection and cannot be added again');
      error.code = 'FIELD_EXISTS';
      throw error;
    }

    const compiled = compileFieldColumn(input);

    return withAdvisoryLock(this.database, 'yuncms:schema', async (connection) => {
      const metadata = new SchemaMetadataRepository(connection);
      const collectionMetadata = await metadata.readCollection(collection);
      if (!collectionMetadata) {
        const error = new Error(`Unknown collection: ${collection}`);
        error.code = 'COLLECTION_NOT_FOUND';
        throw error;
      }
      if (collectionMetadata.system) {
        const error = new Error('System collection fields cannot be changed through the dynamic schema API');
        error.code = 'SYSTEM_SCHEMA_READ_ONLY';
        throw error;
      }

      const existing = await metadata.readField(collection, field);
      if (existing) {
        const error = new Error(`Field already exists: ${collection}.${field}`);
        error.code = 'FIELD_EXISTS';
        throw error;
      }

      const tableName = quoteIdentifier(collection, 'collection name');
      const fieldName = quoteIdentifier(field, 'field name');
      let physicalFieldCreated = false;

      try {
        await connection.query(
          `ALTER TABLE ${tableName} ADD COLUMN ${fieldName} ${compiled.sql}`,
          compiled.params,
        );
        physicalFieldCreated = true;

        return await withConnectionTransaction(connection, async () => {
          const created = await metadata.createField({
            collection,
            field,
            type: input.type,
            required: input.required === true,
            readonly: input.readonly === true,
            hidden: input.hidden === true,
            sort: input.sort ?? null,
            interface: input.interface ?? null,
            options: input.options ?? null,
            schemaMetadata: compiled.schemaMetadata,
          });

          const schemaVersion = await incrementSchemaVersion(connection);
          return { ...created, schemaVersion };
        });
      } catch (error) {
        const cleanupErrors = [];

        try {
          await metadata.deleteField(collection, field);
        } catch (cleanupError) {
          cleanupErrors.push(cleanupError);
        }

        if (physicalFieldCreated) {
          try {
            await connection.query(`ALTER TABLE ${tableName} DROP COLUMN ${fieldName}`);
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

  async updateOne(collection, field, patch) {
    assertSchemaManager(this.accountability);
    assertIdentifier(collection, 'collection name');
    assertFieldName(field);
    assertFieldMetadataPatch(patch);

    if (field === 'id') {
      const error = new Error('Primary key field metadata is read-only in V1');
      error.code = 'SYSTEM_SCHEMA_READ_ONLY';
      throw error;
    }

    return withAdvisoryLock(this.database, 'yuncms:schema', async (connection) => {
      const metadata = new SchemaMetadataRepository(connection);
      const [collectionMetadata, existing] = await Promise.all([
        metadata.readCollection(collection),
        metadata.readField(collection, field),
      ]);

      if (!collectionMetadata) {
        const error = new Error(`Unknown collection: ${collection}`);
        error.code = 'COLLECTION_NOT_FOUND';
        throw error;
      }
      if (collectionMetadata.system) {
        const error = new Error('System collection fields cannot be changed through the dynamic schema API');
        error.code = 'SYSTEM_SCHEMA_READ_ONLY';
        throw error;
      }
      if (!existing) {
        const error = new Error(`Unknown field: ${collection}.${field}`);
        error.code = 'FIELD_NOT_FOUND';
        throw error;
      }

      return withConnectionTransaction(connection, async () => {
        const updated = await metadata.updateFieldMetadata(collection, field, patch);
        const schemaVersion = await incrementSchemaVersion(connection);
        return { ...updated, schemaVersion };
      });
    });
  }

  async deleteOne(collection, field, { destructive = false } = {}) {
    assertSchemaManager(this.accountability);
    assertIdentifier(collection, 'collection name');
    assertFieldName(field);
    if (destructive !== true) {
      const error = new Error('Field deletion requires destructive: true');
      error.code = 'DESTRUCTIVE_OPERATION_REQUIRED';
      throw error;
    }
    if (field === 'id') {
      const error = new Error('Primary key fields cannot be deleted in V1');
      error.code = 'SYSTEM_SCHEMA_READ_ONLY';
      throw error;
    }

    return withAdvisoryLock(this.database, 'yuncms:schema', async (connection) => {
      const metadata = new SchemaMetadataRepository(connection);
      const [collectionMetadata, existing, relations] = await Promise.all([
        metadata.readCollection(collection),
        metadata.readField(collection, field),
        metadata.listRelations(),
      ]);

      if (!collectionMetadata) {
        const error = new Error(`Unknown collection: ${collection}`);
        error.code = 'COLLECTION_NOT_FOUND';
        throw error;
      }
      if (collectionMetadata.system) {
        const error = new Error('System collection fields cannot be deleted through the dynamic schema API');
        error.code = 'SYSTEM_SCHEMA_READ_ONLY';
        throw error;
      }
      if (!existing) {
        const error = new Error(`Unknown field: ${collection}.${field}`);
        error.code = 'FIELD_NOT_FOUND';
        throw error;
      }

      const blockingRelation = relations.find((relation) =>
        (relation.many_collection === collection && relation.many_field === field) ||
        (relation.one_collection === collection && relation.one_field === field) ||
        (relation.junction_collection === collection && relation.junction_field === field));
      if (blockingRelation) {
        const error = new Error(`Field participates in a relation and cannot be deleted: ${collection}.${field}`);
        error.code = 'FIELD_HAS_RELATION';
        throw error;
      }

      const tableName = quoteIdentifier(collection, 'collection name');
      const fieldName = quoteIdentifier(field, 'field name');
      const tombstoneName = temporaryDropName();
      const tombstoneField = quoteIdentifier(tombstoneName, 'temporary field name');

      await connection.query(
        `ALTER TABLE ${tableName} RENAME COLUMN ${fieldName} TO ${tombstoneField}`,
      );

      let result;
      try {
        result = await withConnectionTransaction(connection, async () => {
          const deleted = await metadata.deleteField(collection, field);
          if (deleted !== 1) {
            const error = new Error(`Field metadata disappeared during delete: ${collection}.${field}`);
            error.code = 'SCHEMA_METADATA_DRIFT';
            throw error;
          }
          const schemaVersion = await incrementSchemaVersion(connection);
          return { deleted: true, collection, field, schemaVersion };
        });
      } catch (error) {
        try {
          await connection.query(
            `ALTER TABLE ${tableName} RENAME COLUMN ${tombstoneField} TO ${fieldName}`,
          );
        } catch (restoreError) {
          error.restoreError = restoreError;
          error.code ||= 'SCHEMA_PARTIAL_FAILURE';
        }
        throw error;
      }

      try {
        await connection.query(`ALTER TABLE ${tableName} DROP COLUMN ${tombstoneField}`);
      } catch (cleanupError) {
        const error = new Error(`Field was logically deleted but physical cleanup failed: ${collection}.${field}`);
        error.code = 'SCHEMA_PARTIAL_FAILURE';
        error.cleanupError = cleanupError;
        error.cleanupField = tombstoneName;
        error.logicalDelete = result;
        throw error;
      }

      return result;
    });
  }
}
