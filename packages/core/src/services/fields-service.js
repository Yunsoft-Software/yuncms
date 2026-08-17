import { createHash, randomUUID } from 'node:crypto';

import { withAdvisoryLock } from '../advisory-lock.js';
import { compileFieldColumn } from '../field-types.js';
import { assertIdentifier, quoteIdentifier } from '../identifier.js';
import { SchemaMetadataRepository } from '../schema-metadata-repository.js';
import { normalizeDisplayName, resolveSchemaName } from '../schema-key.js';
import { incrementSchemaVersion } from '../schema-version.js';
import { withConnectionTransaction } from '../transaction.js';
import { BaseService } from './base-service.js';
import { assertSchemaManager } from './schema-access.js';

const FIELD_METADATA_KEYS = new Set(['name', 'readonly', 'hidden', 'sort', 'interface', 'options']);
const FIELD_PHYSICAL_KEYS = new Set([
  'required',
  'defaultValue',
  'removeDefault',
  'defaultPreset',
  'removeDefaultPreset',
  'autoUpdate',
  'indexed',
]);

function assertFieldName(field) {
  assertIdentifier(field, 'field name');
  if (field.length > 64) throw new Error('Field name cannot exceed 64 characters');
  return field;
}

function invalidSchemaPayload(message) {
  const error = new Error(message);
  error.code = 'INVALID_SCHEMA_PAYLOAD';
  return error;
}

function assertFieldMetadataPatch(patch) {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) {
    throw invalidSchemaPayload('Field metadata patch must be an object');
  }
  for (const key of Object.keys(patch)) {
    if (!FIELD_METADATA_KEYS.has(key)) {
      const error = new Error(`Field property cannot be updated through metadata-only V1 update: ${key}`);
      error.code = 'UNSUPPORTED_SCHEMA_UPDATE';
      throw error;
    }
  }
  if (Object.keys(patch).length === 0) {
    throw invalidSchemaPayload('Field metadata patch cannot be empty');
  }
  if (Object.hasOwn(patch, 'name')) patch.name = normalizeDisplayName(patch.name);
}

function assertPhysicalPatch(patch) {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) {
    throw invalidSchemaPayload('Physical field patch must be an object');
  }
  const keys = Object.keys(patch);
  if (keys.length === 0) {
    throw invalidSchemaPayload('Physical field patch cannot be empty');
  }
  for (const key of keys) {
    if (!FIELD_PHYSICAL_KEYS.has(key)) {
      const error = new Error(`Physical field property cannot be changed in V1: ${key}`);
      error.code = 'UNSUPPORTED_SCHEMA_UPDATE';
      throw error;
    }
  }
  if (Object.hasOwn(patch, 'required') && typeof patch.required !== 'boolean') {
    throw invalidSchemaPayload('required must be boolean');
  }
  if (Object.hasOwn(patch, 'indexed') && typeof patch.indexed !== 'boolean') {
    throw invalidSchemaPayload('indexed must be boolean');
  }
  if (Object.hasOwn(patch, 'autoUpdate') && typeof patch.autoUpdate !== 'boolean') {
    throw invalidSchemaPayload('autoUpdate must be boolean');
  }
  for (const key of ['removeDefault', 'removeDefaultPreset']) {
    if (Object.hasOwn(patch, key) && patch[key] !== true) {
      throw invalidSchemaPayload(`${key} must be true when provided`);
    }
  }
  if (Object.hasOwn(patch, 'defaultPreset') && patch.defaultPreset !== 'now') {
    throw invalidSchemaPayload('defaultPreset currently supports only now');
  }
  if (Object.hasOwn(patch, 'defaultValue') && Object.hasOwn(patch, 'defaultPreset')) {
    throw invalidSchemaPayload('defaultValue and defaultPreset cannot be used together');
  }
  if (Object.hasOwn(patch, 'defaultValue') && patch.removeDefault === true) {
    throw invalidSchemaPayload('defaultValue and removeDefault cannot be used together');
  }
  if (Object.hasOwn(patch, 'defaultPreset') && patch.removeDefaultPreset === true) {
    throw invalidSchemaPayload('defaultPreset and removeDefaultPreset cannot be used together');
  }
}

function parseSchemaMetadata(value) {
  if (value == null) return {};
  if (typeof value === 'object') return value;
  try {
    return JSON.parse(value);
  } catch {
    return {};
  }
}

function assertFieldNotSystemManaged(field) {
  if (parseSchemaMetadata(field?.schema_metadata).systemManaged === true) {
    const error = new Error(`System-managed field cannot be changed directly: ${field.collection}.${field.field}`);
    error.code = 'SYSTEM_SCHEMA_READ_ONLY';
    throw error;
  }
}

function fieldInputFromMetadata(field, schemaMetadata) {
  const input = {
    type: field.type,
    required: Boolean(field.required),
    interface: field.interface ?? null,
  };
  if (schemaMetadata.length !== undefined && field.type === 'string') input.length = schemaMetadata.length;
  if (schemaMetadata.precision !== undefined && field.type === 'decimal') input.precision = schemaMetadata.precision;
  if (schemaMetadata.scale !== undefined && field.type === 'decimal') input.scale = schemaMetadata.scale;
  if (Object.hasOwn(schemaMetadata, 'defaultValue')) input.defaultValue = schemaMetadata.defaultValue;
  if (schemaMetadata.defaultPreset !== undefined) input.defaultPreset = schemaMetadata.defaultPreset;
  if (schemaMetadata.autoUpdate === true) input.autoUpdate = true;
  return input;
}

function indexName(collection, field) {
  const digest = createHash('sha256').update(`${collection}:${field}:index`).digest('hex').slice(0, 24);
  return `yidx_${digest}`;
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
    const resolvedName = resolveSchemaName({
      displayName: input.name ?? input.field,
      key: input.field,
      prefix: 'field',
    });
    const field = assertFieldName(resolvedName.key);
    const name = resolvedName.name;

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
            name,
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
      assertFieldNotSystemManaged(existing);

      return withConnectionTransaction(connection, async () => {
        const updated = await metadata.updateFieldMetadata(collection, field, patch);
        const schemaVersion = await incrementSchemaVersion(connection);
        return { ...updated, schemaVersion };
      });
    });
  }

  async updateSchema(collection, field, patch) {
    assertSchemaManager(this.accountability);
    assertIdentifier(collection, 'collection name');
    assertFieldName(field);
    assertPhysicalPatch(patch);
    if (field === 'id') {
      const error = new Error('Primary key field schema cannot be changed in V1');
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
        const error = new Error('System collection fields cannot be changed through the dynamic schema API');
        error.code = 'SYSTEM_SCHEMA_READ_ONLY';
        throw error;
      }
      if (!existing) {
        const error = new Error(`Unknown field: ${collection}.${field}`);
        error.code = 'FIELD_NOT_FOUND';
        throw error;
      }
      assertFieldNotSystemManaged(existing);

      const relation = relations.find((candidate) =>
        candidate.many_collection === collection && candidate.many_field === field);
      const nextRequired = Object.hasOwn(patch, 'required') ? patch.required : Boolean(existing.required);
      if (relation?.on_delete === 'SET NULL' && nextRequired) {
        const error = new Error('A SET NULL relation field cannot be changed to required');
        error.code = 'INVALID_ON_DELETE';
        throw error;
      }

      const currentMetadata = parseSchemaMetadata(existing.schema_metadata);
      const currentInput = fieldInputFromMetadata(existing, currentMetadata);
      const nextInput = { ...currentInput, required: nextRequired };

      if (patch.removeDefault === true) delete nextInput.defaultValue;
      if (patch.removeDefaultPreset === true) delete nextInput.defaultPreset;
      if (Object.hasOwn(patch, 'defaultValue')) {
        nextInput.defaultValue = patch.defaultValue;
        delete nextInput.defaultPreset;
      }
      if (Object.hasOwn(patch, 'defaultPreset')) {
        nextInput.defaultPreset = patch.defaultPreset;
        delete nextInput.defaultValue;
      }
      if (Object.hasOwn(patch, 'autoUpdate')) nextInput.autoUpdate = patch.autoUpdate;

      const currentCompiled = compileFieldColumn(currentInput);
      const nextCompiled = compileFieldColumn(nextInput);
      const currentIndexed = currentMetadata.indexed === true;
      const nextIndexed = Object.hasOwn(patch, 'indexed') ? patch.indexed : currentIndexed;
      const tableName = quoteIdentifier(collection, 'collection name');
      const fieldName = quoteIdentifier(field, 'field name');
      const physicalIndexName = indexName(collection, field);
      const indexSql = quoteIdentifier(physicalIndexName, 'index name');

      const restorePhysical = async () => {
        const restoreErrors = [];
        try {
          await connection.query(
            `ALTER TABLE ${tableName} MODIFY COLUMN ${fieldName} ${currentCompiled.sql}`,
            currentCompiled.params,
          );
        } catch (error) {
          restoreErrors.push(error);
        }
        if (currentIndexed !== nextIndexed) {
          try {
            if (currentIndexed) {
              await connection.query(`ALTER TABLE ${tableName} ADD INDEX ${indexSql} (${fieldName})`);
            } else {
              await connection.query(`ALTER TABLE ${tableName} DROP INDEX ${indexSql}`);
            }
          } catch (error) {
            restoreErrors.push(error);
          }
        }
        return restoreErrors;
      };

      try {
        await connection.query(
          `ALTER TABLE ${tableName} MODIFY COLUMN ${fieldName} ${nextCompiled.sql}`,
          nextCompiled.params,
        );
        if (currentIndexed !== nextIndexed) {
          if (nextIndexed) {
            await connection.query(`ALTER TABLE ${tableName} ADD INDEX ${indexSql} (${fieldName})`);
          } else {
            await connection.query(`ALTER TABLE ${tableName} DROP INDEX ${indexSql}`);
          }
        }

        return await withConnectionTransaction(connection, async () => {
          const updated = await metadata.updateFieldPhysicalMetadata(collection, field, {
            required: nextRequired,
            schemaMetadata: {
              ...nextCompiled.schemaMetadata,
              indexed: nextIndexed,
            },
          });
          const schemaVersion = await incrementSchemaVersion(connection);
          return { ...updated, schemaVersion };
        });
      } catch (error) {
        const restoreErrors = await restorePhysical();
        if (restoreErrors.length > 0) {
          error.restoreErrors = restoreErrors;
          error.code ||= 'SCHEMA_PARTIAL_FAILURE';
        }
        throw error;
      }
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
      assertFieldNotSystemManaged(existing);

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
