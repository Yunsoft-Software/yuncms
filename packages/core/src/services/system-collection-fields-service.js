import { withAdvisoryLock } from '../advisory-lock.js';
import { compileFieldColumn } from '../field-types.js';
import { assertIdentifier, quoteIdentifier } from '../identifier.js';
import { SchemaMetadataRepository } from '../schema-metadata-repository.js';
import { incrementSchemaVersion } from '../schema-version.js';
import { isPermissionManagedSystemResource } from '../system-permissions.js';
import { withConnectionTransaction } from '../transaction.js';
import { BaseService } from './base-service.js';
import { assertSchemaManager } from './schema-access.js';

function fieldName(value) {
  assertIdentifier(value, 'field name');
  if (value.length > 64) {
    const error = new Error('Field name cannot exceed 64 characters');
    error.code = 'INVALID_SCHEMA_PAYLOAD';
    throw error;
  }
  if (value === 'id') {
    const error = new Error('The id field cannot be replaced');
    error.code = 'FIELD_EXISTS';
    throw error;
  }
  return value;
}

function assertExtensibleSystemCollection(collection) {
  if (!collection?.system || !isPermissionManagedSystemResource(collection)) {
    const error = new Error(`System collection is not extensible: ${collection?.collection || 'unknown'}`);
    error.code = 'SYSTEM_SCHEMA_READ_ONLY';
    throw error;
  }
}

function assertSystemExtensionInput(input = {}) {
  if (input.required === true) {
    const error = new Error('Custom system collection fields must be optional in V1');
    error.code = 'SYSTEM_EXTENSION_REQUIRED_UNSUPPORTED';
    throw error;
  }
}

export class SystemCollectionFieldsService extends BaseService {
  async createOne(collectionName, input = {}) {
    assertSchemaManager(this.accountability);
    assertIdentifier(collectionName, 'collection name');
    assertSystemExtensionInput(input);
    const field = fieldName(input.field);
    const compiled = compileFieldColumn({ ...input, required: false });

    return withAdvisoryLock(this.database, 'yuncms:schema', async (connection) => {
      const metadata = new SchemaMetadataRepository(connection);
      const collection = await metadata.readCollection(collectionName);
      if (!collection) {
        const error = new Error(`Unknown collection: ${collectionName}`);
        error.code = 'COLLECTION_NOT_FOUND';
        throw error;
      }
      assertExtensibleSystemCollection(collection);

      const existing = await metadata.readField(collectionName, field);
      if (existing) {
        const error = new Error(`Field already exists: ${collectionName}.${field}`);
        error.code = 'FIELD_EXISTS';
        throw error;
      }

      const table = quoteIdentifier(collectionName, 'collection name');
      const column = quoteIdentifier(field, 'field name');
      let physicalCreated = false;

      try {
        await connection.query(`ALTER TABLE ${table} ADD COLUMN ${column} ${compiled.sql}`, compiled.params);
        physicalCreated = true;

        return await withConnectionTransaction(connection, async () => {
          const created = await metadata.createField({
            collection: collectionName,
            field,
            type: input.type,
            required: false,
            readonly: input.readonly === true,
            hidden: input.hidden === true,
            sort: input.sort ?? null,
            interface: input.interface ?? null,
            options: input.options ?? null,
            schemaMetadata: {
              ...compiled.schemaMetadata,
              systemExtension: true,
            },
          });
          const schemaVersion = await incrementSchemaVersion(connection);
          return { ...created, schemaVersion };
        });
      } catch (error) {
        try {
          await metadata.deleteField(collectionName, field);
        } catch (cleanupError) {
          error.cleanupMetadataError = cleanupError;
        }
        if (physicalCreated) {
          try {
            await connection.query(`ALTER TABLE ${table} DROP COLUMN ${column}`);
          } catch (cleanupError) {
            error.cleanupPhysicalError = cleanupError;
            error.code ||= 'SCHEMA_PARTIAL_FAILURE';
          }
        }
        throw error;
      }
    });
  }
}

export { assertExtensibleSystemCollection, assertSystemExtensionInput };
