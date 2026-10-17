import { randomUUID } from 'node:crypto';

import { withAdvisoryLock } from '../advisory-lock.js';
import { compileFieldColumn } from '../field-types.js';
import { assertFieldIndexOptions, assertNoDuplicateFieldValues, fieldIndexClause, fieldIndexName, safeFieldIndexError } from '../field-index.js';
import { assertIdentifier, quoteIdentifier } from '../identifier.js';
import { SchemaMetadataRepository } from '../schema-metadata-repository.js';
import { normalizeDisplayName, resolveSchemaName } from '../schema-key.js';
import { incrementSchemaVersion } from '../schema-version.js';
import { assertSchemaDDLAllowed } from '../schema-ddl.js';
import { fieldRecoveryError, fieldRecoverySignature, inspectFieldRecovery } from '../field-recovery.js';
import { readSchemaVersion } from '../schema-version.js';
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
  'unique',
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
  assertFieldIndexOptions(patch);
  if (Object.hasOwn(patch, 'autoUpdate') && typeof patch.autoUpdate !== 'boolean') {
    throw invalidSchemaPayload('autoUpdate must be boolean');
  }
  for (const key of ['removeDefault', 'removeDefaultPreset']) {
    if (Object.hasOwn(patch, key) && patch[key] !== true) {
      throw invalidSchemaPayload(`${key} must be true when provided`);
    }
  }
  if (Object.hasOwn(patch, 'defaultPreset') && !['now', 'current_user'].includes(patch.defaultPreset)) {
    throw invalidSchemaPayload('defaultPreset supports now or current_user');
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
    assertFieldIndexOptions(input);
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
      assertSchemaDDLAllowed(connection);
      await this.filter('schema.field.create', input, { collection, key: field, database: connection });
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
        const index = fieldIndexClause(collection, field, input);
        await connection.query(
          `ALTER TABLE ${tableName} ADD COLUMN ${fieldName} ${compiled.sql}${index ? `, ${index}` : ''}`,
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
            schemaMetadata: { ...compiled.schemaMetadata, indexed: input.indexed === true, unique: input.unique === true },
          });

          const schemaVersion = await incrementSchemaVersion(connection);
          return { ...created, schemaVersion };
        });
      } catch (error) {
        if (!physicalFieldCreated && error.code === 'ER_DUP_FIELDNAME') {
          throw fieldRecoveryError('SCHEMA_RECOVERY_REQUIRED', collection, field);
        }
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
          error.code = 'SCHEMA_PARTIAL_FAILURE';
        }
        throw safeFieldIndexError(error);
      }
    });
  }

  async inspectRecovery(collection, field, definition) {
    return this.recoverOne(collection, field, { definition }, { inspect: true });
  }

  async recoverOne(collection, field, { definition, expectedSignature, confirm } = {}, { inspect = false } = {}) {
    assertSchemaManager(this.accountability);
    assertIdentifier(collection, 'collection name');
    assertFieldName(field);
    if (field === 'id') throw fieldRecoveryError('SYSTEM_SCHEMA_READ_ONLY', collection, field);
    if (!definition || typeof definition !== 'object' || Array.isArray(definition) || definition.field !== field) {
      throw invalidSchemaPayload('Recovery requires the exact field definition');
    }
    if (!inspect && (confirm !== true || !/^[a-f0-9]{64}$/.test(expectedSignature ?? ''))) {
      throw invalidSchemaPayload('Explicit recovery confirmation and inspected physical signature are required');
    }
    const compiled = compileFieldColumn(definition);
    return withAdvisoryLock(this.database, 'yuncms:schema', async connection => {
      assertSchemaDDLAllowed(connection);
      const metadata = new SchemaMetadataRepository(connection);
      const currentCollection = await metadata.readCollection(collection);
      if (!currentCollection) throw fieldRecoveryError('COLLECTION_NOT_FOUND', collection, field);
      if (currentCollection.system) throw fieldRecoveryError('SYSTEM_SCHEMA_READ_ONLY', collection, field);
      if (await metadata.readField(collection, field)) throw fieldRecoveryError('FIELD_EXISTS', collection, field);
      const preview = await inspectFieldRecovery(connection, collection, field, definition, await readSchemaVersion(connection));
      if (inspect) return preview;
      if (!preview.compatible) throw fieldRecoveryError('SCHEMA_RECOVERY_MISMATCH', collection, field);
      if (preview.signature !== expectedSignature) throw fieldRecoveryError('SCHEMA_RECOVERY_STALE', collection, field);
      return withConnectionTransaction(connection, async () => {
        await this.filter('schema.field.create', definition, { collection, key: field, database: connection, recovery: true });
        if (fieldRecoverySignature({ collection, field, definition, physical: preview.physical, schemaVersion: preview.schemaVersion }) !== expectedSignature) {
          throw fieldRecoveryError('SCHEMA_RECOVERY_STALE', collection, field);
        }
        const created = await metadata.createField({
          collection, field, name: normalizeDisplayName(definition.name ?? field), type: definition.type,
          required: definition.required === true, readonly: definition.readonly === true, hidden: definition.hidden === true,
          sort: definition.sort ?? null, interface: definition.interface ?? null, options: definition.options ?? null,
          schemaMetadata: { ...compiled.schemaMetadata, indexed: definition.indexed === true, unique: definition.unique === true },
        });
        return { ...created, schemaVersion: await incrementSchemaVersion(connection) };
      });
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
      await this.filter('schema.field.update', patch, { collection, key: field, database: connection });
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
      assertSchemaDDLAllowed(connection);
      await this.filter('schema.field.update', patch, { collection, key: field, physical: true, database: connection });
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
      let nextIndexed = Object.hasOwn(patch, 'indexed') ? patch.indexed : currentIndexed;
      const currentUnique = currentMetadata.unique === true;
      const nextUnique = Object.hasOwn(patch, 'unique') ? patch.unique : currentUnique;
      assertFieldIndexOptions({ ...nextInput, indexed: nextIndexed, unique: nextUnique });
      const tableName = quoteIdentifier(collection, 'collection name');
      const fieldName = quoteIdentifier(field, 'field name');
      const physicalIndexName = fieldIndexName(collection, field);
      const indexSql = quoteIdentifier(physicalIndexName, 'index name');
      if (relation && (currentUnique || currentIndexed) && !nextUnique && !nextIndexed) {
        const [indexes] = await connection.query(`SHOW INDEX FROM ${tableName}`);
        const anotherSupportingIndex = indexes.some(index => index.Key_name !== physicalIndexName
          && index.Column_name === field && Number(index.Seq_in_index) === 1 && index.Sub_part == null);
        if (!anotherSupportingIndex) {
          if (patch.indexed === false) throw invalidSchemaPayload('A relation field must retain an index for its foreign key');
          nextIndexed = true;
        }
      }
      const currentIndex = fieldIndexClause(collection, field, { indexed: currentIndexed, unique: currentUnique });
      const nextIndex = fieldIndexClause(collection, field, { indexed: nextIndexed, unique: nextUnique });
      const indexChanged = currentIndex !== nextIndex;
      if (nextUnique && !currentUnique) await assertNoDuplicateFieldValues(connection, collection, field);
      const columnChanged = currentCompiled.sql !== nextCompiled.sql || JSON.stringify(currentCompiled.params) !== JSON.stringify(nextCompiled.params);
      const changes = [], restores = [];
      if (columnChanged) {
        changes.push(`MODIFY COLUMN ${fieldName} ${nextCompiled.sql}`);
        restores.push(`MODIFY COLUMN ${fieldName} ${currentCompiled.sql}`);
      }
      if (indexChanged) {
        if (currentIndex) changes.push(`DROP INDEX ${indexSql}`);
        if (nextIndex) changes.push(nextIndex);
        if (nextIndex) restores.push(`DROP INDEX ${indexSql}`);
        if (currentIndex) restores.push(currentIndex);
      }
      let physicalChanged = false;

      try {
        // InnoDB validates the whole ALTER atomically, including a concurrent duplicate after preflight.
        if (changes.length) {
          await connection.query(`ALTER TABLE ${tableName} ${changes.join(', ')}`, columnChanged ? nextCompiled.params : []);
          physicalChanged = true;
        }

        return await withConnectionTransaction(connection, async () => {
          const updated = await metadata.updateFieldPhysicalMetadata(collection, field, {
            required: nextRequired,
            schemaMetadata: {
              ...nextCompiled.schemaMetadata,
              indexed: nextIndexed,
              unique: nextUnique,
            },
          });
          const schemaVersion = await incrementSchemaVersion(connection);
          return { ...updated, schemaVersion };
        });
      } catch (error) {
        if (physicalChanged) {
          try {
            await connection.query(`ALTER TABLE ${tableName} ${restores.join(', ')}`, columnChanged ? currentCompiled.params : []);
          } catch (restoreError) {
            error.restoreErrors = [restoreError];
            error.code = 'SCHEMA_PARTIAL_FAILURE';
          }
        }
        throw safeFieldIndexError(error);
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
      await this.filter('schema.field.delete', { destructive }, { collection, key: field, database: connection });
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
