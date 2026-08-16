import { createHash } from 'node:crypto';

import { withAdvisoryLock } from '../advisory-lock.js';
import { compileFieldColumn } from '../field-types.js';
import { assertIdentifier, quoteIdentifier } from '../identifier.js';
import { SchemaMetadataRepository } from '../schema-metadata-repository.js';
import { incrementSchemaVersion } from '../schema-version.js';
import { withConnectionTransaction } from '../transaction.js';
import { BaseService } from './base-service.js';
import { assertSchemaManager } from './schema-access.js';

const ON_DELETE_ACTIONS = new Set(['RESTRICT', 'CASCADE', 'SET NULL']);

function constraintName(manyCollection, manyField, oneCollection) {
  const digest = createHash('sha256')
    .update(`${manyCollection}:${manyField}:${oneCollection}`)
    .digest('hex')
    .slice(0, 24);
  return `yfk_${digest}`;
}

function assertOnDelete(value) {
  const action = String(value ?? 'RESTRICT').toUpperCase();
  if (!ON_DELETE_ACTIONS.has(action)) {
    const error = new Error(`Unsupported ON DELETE action: ${action}`);
    error.code = 'INVALID_ON_DELETE';
    throw error;
  }
  return action;
}

function assertUserSchemaIdentifier(value, label) {
  const identifier = assertIdentifier(value, label);
  if (identifier.length > 64) {
    const error = new Error(`${label} cannot exceed 64 characters`);
    error.code = 'INVALID_SCHEMA_PAYLOAD';
    throw error;
  }
  if (identifier.toLowerCase().startsWith('yuncms_')) {
    const error = new Error(`The yuncms_ prefix is reserved: ${identifier}`);
    error.code = 'RESERVED_COLLECTION_NAME';
    throw error;
  }
  return identifier;
}

function parseRelationMetadata(value) {
  if (value == null) return {};
  if (typeof value === 'object') return value;
  try {
    return JSON.parse(value);
  } catch {
    return {};
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

function fieldDefinitionFromMetadata(field, { required = true } = {}) {
  const schema = parseSchemaMetadata(field.schema_metadata);
  const input = { type: field.type, required };
  if (field.type === 'string' && schema.length !== undefined) input.length = schema.length;
  if (field.type === 'decimal') {
    if (schema.precision !== undefined) input.precision = schema.precision;
    if (schema.scale !== undefined) input.scale = schema.scale;
  }
  return compileFieldColumn(input);
}

export class RelationsService extends BaseService {
  async readMany() {
    assertSchemaManager(this.accountability);
    return new SchemaMetadataRepository(this.database).listRelations();
  }

  async readOne(manyCollection, manyField) {
    assertSchemaManager(this.accountability);
    assertIdentifier(manyCollection, 'collection name');
    assertIdentifier(manyField, 'field name');
    return new SchemaMetadataRepository(this.database).readRelation(manyCollection, manyField);
  }

  async readO2M(oneCollection) {
    assertSchemaManager(this.accountability);
    assertIdentifier(oneCollection, 'one collection');
    return new SchemaMetadataRepository(this.database).listRelationsForOne(oneCollection);
  }

  async createM2O(input = {}) {
    assertSchemaManager(this.accountability);
    const manyCollection = assertIdentifier(input.manyCollection, 'many collection');
    const manyField = assertIdentifier(input.manyField, 'many field');
    const oneCollection = assertIdentifier(input.oneCollection, 'one collection');
    const onDelete = assertOnDelete(input.onDelete);

    return withAdvisoryLock(this.database, 'yuncms:schema', async (connection) => {
      const metadata = new SchemaMetadataRepository(connection);
      const [manyCollectionMetadata, oneCollectionMetadata] = await Promise.all([
        metadata.readCollection(manyCollection),
        metadata.readCollection(oneCollection),
      ]);

      if (!manyCollectionMetadata || !oneCollectionMetadata) {
        const error = new Error('Both relation collections must exist');
        error.code = 'COLLECTION_NOT_FOUND';
        throw error;
      }
      if (manyCollectionMetadata.system || oneCollectionMetadata.system) {
        const error = new Error('System collections cannot be changed through the dynamic relation API');
        error.code = 'SYSTEM_SCHEMA_READ_ONLY';
        throw error;
      }

      const oneField = input.oneField ?? oneCollectionMetadata.primary_key;
      assertIdentifier(oneField, 'one field');
      if (oneField !== oneCollectionMetadata.primary_key) {
        const error = new Error('V1 M2O relations must reference the target collection primary key');
        error.code = 'UNSUPPORTED_RELATION_TARGET';
        throw error;
      }

      const [manyFieldMetadata, oneFieldMetadata, existingRelation] = await Promise.all([
        metadata.readField(manyCollection, manyField),
        metadata.readField(oneCollection, oneField),
        metadata.readRelation(manyCollection, manyField),
      ]);

      if (!manyFieldMetadata || !oneFieldMetadata) {
        const error = new Error('Both relation fields must exist in schema metadata');
        error.code = 'FIELD_NOT_FOUND';
        throw error;
      }
      if (existingRelation) {
        const error = new Error(`Relation already exists for ${manyCollection}.${manyField}`);
        error.code = 'RELATION_EXISTS';
        throw error;
      }
      if (manyFieldMetadata.type !== oneFieldMetadata.type) {
        const error = new Error(
          `Relation field types do not match: ${manyFieldMetadata.type} -> ${oneFieldMetadata.type}`,
        );
        error.code = 'RELATION_TYPE_MISMATCH';
        throw error;
      }
      if (onDelete === 'SET NULL' && Boolean(manyFieldMetadata.required)) {
        const error = new Error('SET NULL cannot be used with a required relation field');
        error.code = 'INVALID_ON_DELETE';
        throw error;
      }

      const fkName = constraintName(manyCollection, manyField, oneCollection);
      const manyTableSql = quoteIdentifier(manyCollection, 'many collection');
      const manyFieldSql = quoteIdentifier(manyField, 'many field');
      const oneTableSql = quoteIdentifier(oneCollection, 'one collection');
      const oneFieldSql = quoteIdentifier(oneField, 'one field');
      const constraintSql = quoteIdentifier(fkName, 'constraint name');
      let physicalRelationCreated = false;

      try {
        await connection.query(
          `ALTER TABLE ${manyTableSql}
           ADD CONSTRAINT ${constraintSql}
           FOREIGN KEY (${manyFieldSql}) REFERENCES ${oneTableSql} (${oneFieldSql})
           ON DELETE ${onDelete}`,
        );
        physicalRelationCreated = true;

        return await withConnectionTransaction(connection, async () => {
          const created = await metadata.createRelation({
            manyCollection,
            manyField,
            oneCollection,
            oneField,
            onDelete,
            metadata: { constraintName: fkName, kind: 'm2o' },
          });

          const schemaVersion = await incrementSchemaVersion(connection);
          return { ...created, schemaVersion };
        });
      } catch (error) {
        const cleanupErrors = [];

        try {
          await metadata.deleteRelation(manyCollection, manyField);
        } catch (cleanupError) {
          cleanupErrors.push(cleanupError);
        }

        if (physicalRelationCreated) {
          try {
            await connection.query(
              `ALTER TABLE ${manyTableSql} DROP FOREIGN KEY ${constraintSql}`,
            );
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

  async createM2M(input = {}) {
    assertSchemaManager(this.accountability);
    const junctionCollection = assertUserSchemaIdentifier(input.junctionCollection, 'junction collection');
    const leftCollection = assertIdentifier(input.leftCollection, 'left collection');
    const rightCollection = assertIdentifier(input.rightCollection, 'right collection');
    const leftField = assertUserSchemaIdentifier(input.leftField ?? `${leftCollection}_id`, 'left junction field');
    const rightField = assertUserSchemaIdentifier(input.rightField ?? `${rightCollection}_id`, 'right junction field');
    if (leftField === rightField) {
      const error = new Error('M2M junction fields must be distinct; provide explicit leftField/rightField names');
      error.code = 'INVALID_SCHEMA_PAYLOAD';
      throw error;
    }

    const leftOnDelete = assertOnDelete(input.leftOnDelete ?? 'CASCADE');
    const rightOnDelete = assertOnDelete(input.rightOnDelete ?? 'CASCADE');
    if (leftOnDelete === 'SET NULL' || rightOnDelete === 'SET NULL') {
      const error = new Error('M2M junction fields are required; SET NULL is not supported');
      error.code = 'INVALID_ON_DELETE';
      throw error;
    }

    return withAdvisoryLock(this.database, 'yuncms:schema', async (connection) => {
      const metadata = new SchemaMetadataRepository(connection);
      const [junctionExisting, leftMetadata, rightMetadata] = await Promise.all([
        metadata.readCollection(junctionCollection),
        metadata.readCollection(leftCollection),
        metadata.readCollection(rightCollection),
      ]);
      if (junctionExisting) {
        const error = new Error(`Junction collection already exists: ${junctionCollection}`);
        error.code = 'COLLECTION_EXISTS';
        throw error;
      }
      if (!leftMetadata || !rightMetadata) {
        const error = new Error('Both M2M target collections must exist');
        error.code = 'COLLECTION_NOT_FOUND';
        throw error;
      }
      if (leftMetadata.system || rightMetadata.system) {
        const error = new Error('System collections cannot participate in dynamic M2M creation');
        error.code = 'SYSTEM_SCHEMA_READ_ONLY';
        throw error;
      }

      const leftPrimaryKey = leftMetadata.primary_key;
      const rightPrimaryKey = rightMetadata.primary_key;
      const [leftPk, rightPk] = await Promise.all([
        metadata.readField(leftCollection, leftPrimaryKey),
        metadata.readField(rightCollection, rightPrimaryKey),
      ]);
      if (!leftPk || !rightPk) {
        const error = new Error('M2M target primary-key metadata is missing');
        error.code = 'SCHEMA_METADATA_DRIFT';
        throw error;
      }

      const leftColumn = fieldDefinitionFromMetadata(leftPk, { required: true });
      const rightColumn = fieldDefinitionFromMetadata(rightPk, { required: true });
      const junctionSql = quoteIdentifier(junctionCollection, 'junction collection');
      const leftFieldSql = quoteIdentifier(leftField, 'left junction field');
      const rightFieldSql = quoteIdentifier(rightField, 'right junction field');
      const leftCollectionSql = quoteIdentifier(leftCollection, 'left collection');
      const rightCollectionSql = quoteIdentifier(rightCollection, 'right collection');
      const leftPkSql = quoteIdentifier(leftPrimaryKey, 'left primary key');
      const rightPkSql = quoteIdentifier(rightPrimaryKey, 'right primary key');
      const leftFk = constraintName(junctionCollection, leftField, leftCollection);
      const rightFk = constraintName(junctionCollection, rightField, rightCollection);
      const leftFkSql = quoteIdentifier(leftFk, 'left foreign key');
      const rightFkSql = quoteIdentifier(rightFk, 'right foreign key');
      const uniqueName = quoteIdentifier(
        `yuq_${createHash('sha256').update(`${junctionCollection}:${leftField}:${rightField}`).digest('hex').slice(0, 24)}`,
        'junction unique index',
      );
      let tableCreated = false;

      try {
        await connection.query(
          `CREATE TABLE ${junctionSql} (
            id CHAR(36) NOT NULL PRIMARY KEY,
            ${leftFieldSql} ${leftColumn.sql},
            ${rightFieldSql} ${rightColumn.sql},
            CONSTRAINT ${leftFkSql} FOREIGN KEY (${leftFieldSql})
              REFERENCES ${leftCollectionSql} (${leftPkSql}) ON DELETE ${leftOnDelete},
            CONSTRAINT ${rightFkSql} FOREIGN KEY (${rightFieldSql})
              REFERENCES ${rightCollectionSql} (${rightPkSql}) ON DELETE ${rightOnDelete},
            UNIQUE KEY ${uniqueName} (${leftFieldSql}, ${rightFieldSql})
          ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
          [...leftColumn.params, ...rightColumn.params],
        );
        tableCreated = true;

        return await withConnectionTransaction(connection, async () => {
          await metadata.createCollection({
            collection: junctionCollection,
            primaryKey: 'id',
            hidden: input.hidden !== false,
            note: input.note ?? `M2M junction: ${leftCollection} <-> ${rightCollection}`,
            metadata: {
              junction: true,
              leftCollection,
              rightCollection,
            },
          });
          await metadata.createField({
            collection: junctionCollection,
            field: 'id',
            type: 'uuid',
            required: true,
            readonly: true,
            interface: 'input',
            schemaMetadata: { primaryKey: true, length: 36 },
          });
          await metadata.createField({
            collection: junctionCollection,
            field: leftField,
            type: leftPk.type,
            required: true,
            interface: 'relation-m2o',
            schemaMetadata: leftColumn.schemaMetadata,
          });
          await metadata.createField({
            collection: junctionCollection,
            field: rightField,
            type: rightPk.type,
            required: true,
            interface: 'relation-m2o',
            schemaMetadata: rightColumn.schemaMetadata,
          });

          const leftRelation = await metadata.createRelation({
            manyCollection: junctionCollection,
            manyField: leftField,
            oneCollection: leftCollection,
            oneField: leftPrimaryKey,
            junctionCollection,
            junctionField: rightField,
            onDelete: leftOnDelete,
            metadata: { constraintName: leftFk, kind: 'm2m', side: 'left' },
          });
          const rightRelation = await metadata.createRelation({
            manyCollection: junctionCollection,
            manyField: rightField,
            oneCollection: rightCollection,
            oneField: rightPrimaryKey,
            junctionCollection,
            junctionField: leftField,
            onDelete: rightOnDelete,
            metadata: { constraintName: rightFk, kind: 'm2m', side: 'right' },
          });

          const schemaVersion = await incrementSchemaVersion(connection);
          return {
            junctionCollection,
            leftField,
            rightField,
            leftRelation,
            rightRelation,
            schemaVersion,
          };
        });
      } catch (error) {
        const cleanupErrors = [];
        try {
          await metadata.deleteRelation(junctionCollection, leftField);
          await metadata.deleteRelation(junctionCollection, rightField);
          await metadata.deleteCollection(junctionCollection);
        } catch (cleanupError) {
          cleanupErrors.push(cleanupError);
        }
        if (tableCreated) {
          try {
            await connection.query(`DROP TABLE IF EXISTS ${junctionSql}`);
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

  async deleteM2O(manyCollection, manyField) {
    assertSchemaManager(this.accountability);
    assertIdentifier(manyCollection, 'many collection');
    assertIdentifier(manyField, 'many field');

    return withAdvisoryLock(this.database, 'yuncms:schema', async (connection) => {
      const metadata = new SchemaMetadataRepository(connection);
      const relation = await metadata.readRelation(manyCollection, manyField);
      if (!relation) {
        const error = new Error(`Unknown relation: ${manyCollection}.${manyField}`);
        error.code = 'RELATION_NOT_FOUND';
        throw error;
      }

      const relationMetadata = parseRelationMetadata(relation.metadata);
      const fkName = relationMetadata.constraintName
        ?? constraintName(relation.many_collection, relation.many_field, relation.one_collection);
      const manyTableSql = quoteIdentifier(relation.many_collection, 'many collection');
      const manyFieldSql = quoteIdentifier(relation.many_field, 'many field');
      const oneTableSql = quoteIdentifier(relation.one_collection, 'one collection');
      const oneFieldSql = quoteIdentifier(relation.one_field, 'one field');
      const constraintSql = quoteIdentifier(fkName, 'constraint name');
      const onDelete = assertOnDelete(relation.on_delete);

      await connection.query(`ALTER TABLE ${manyTableSql} DROP FOREIGN KEY ${constraintSql}`);

      try {
        return await withConnectionTransaction(connection, async () => {
          const deleted = await metadata.deleteRelation(manyCollection, manyField);
          if (deleted !== 1) {
            const error = new Error(`Relation metadata disappeared during delete: ${manyCollection}.${manyField}`);
            error.code = 'SCHEMA_METADATA_DRIFT';
            throw error;
          }
          const schemaVersion = await incrementSchemaVersion(connection);
          return { deleted: true, schemaVersion };
        });
      } catch (error) {
        try {
          await connection.query(
            `ALTER TABLE ${manyTableSql}
             ADD CONSTRAINT ${constraintSql}
             FOREIGN KEY (${manyFieldSql}) REFERENCES ${oneTableSql} (${oneFieldSql})
             ON DELETE ${onDelete}`,
          );
        } catch (restoreError) {
          error.restoreError = restoreError;
          error.code ||= 'SCHEMA_PARTIAL_FAILURE';
        }
        throw error;
      }
    });
  }
}
