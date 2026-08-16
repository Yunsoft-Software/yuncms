import { withAdvisoryLock } from '../advisory-lock.js';
import { compileFieldColumn } from '../field-types.js';
import { assertIdentifier, quoteIdentifier } from '../identifier.js';
import { SchemaMetadataRepository } from '../schema-metadata-repository.js';
import { incrementSchemaVersion } from '../schema-version.js';
import { withConnectionTransaction } from '../transaction.js';
import { BaseService } from './base-service.js';

function assertFieldName(field) {
  assertIdentifier(field, 'field name');
  if (field.length > 64) throw new Error('Field name cannot exceed 64 characters');
  return field;
}

export class FieldsService extends BaseService {
  async readMany(collection) {
    assertIdentifier(collection, 'collection name');
    return new SchemaMetadataRepository(this.database).listFields(collection);
  }

  async readOne(collection, field) {
    assertIdentifier(collection, 'collection name');
    assertFieldName(field);
    return new SchemaMetadataRepository(this.database).readField(collection, field);
  }

  async createOne(collection, input = {}) {
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
}
