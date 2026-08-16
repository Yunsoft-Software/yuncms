import { createHash } from 'node:crypto';

import { withAdvisoryLock } from '../advisory-lock.js';
import { assertIdentifier, quoteIdentifier } from '../identifier.js';
import { SchemaMetadataRepository } from '../schema-metadata-repository.js';
import { incrementSchemaVersion } from '../schema-version.js';
import { withConnectionTransaction } from '../transaction.js';
import { BaseService } from './base-service.js';

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

function parseRelationMetadata(value) {
  if (value == null) return {};
  if (typeof value === 'object') return value;
  try {
    return JSON.parse(value);
  } catch {
    return {};
  }
}

export class RelationsService extends BaseService {
  async readMany() {
    return new SchemaMetadataRepository(this.database).listRelations();
  }

  async readOne(manyCollection, manyField) {
    assertIdentifier(manyCollection, 'collection name');
    assertIdentifier(manyField, 'field name');
    return new SchemaMetadataRepository(this.database).readRelation(manyCollection, manyField);
  }

  async readO2M(oneCollection) {
    assertIdentifier(oneCollection, 'one collection');
    return new SchemaMetadataRepository(this.database).listRelationsForOne(oneCollection);
  }

  async createM2O(input = {}) {
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

  async deleteM2O(manyCollection, manyField) {
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
