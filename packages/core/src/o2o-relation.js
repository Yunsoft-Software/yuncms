import { createHash } from 'node:crypto';

import { withAdvisoryLock } from './advisory-lock.js';
import { assertIdentifier, quoteIdentifier } from './identifier.js';
import { SchemaMetadataRepository } from './schema-metadata-repository.js';
import { incrementSchemaVersion } from './schema-version.js';
import { withConnectionTransaction } from './transaction.js';
import { assertSchemaManager } from './services/schema-access.js';

const ON_DELETE_ACTIONS = new Set(['RESTRICT', 'CASCADE', 'SET NULL']);

function parseMetadata(value) {
  if (!value) return {};
  if (typeof value === 'object') return value;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
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

function constraintName(manyCollection, manyField, oneCollection) {
  const digest = createHash('sha256')
    .update(`${manyCollection}:${manyField}:${oneCollection}`)
    .digest('hex')
    .slice(0, 24);
  return `yfk_${digest}`;
}

export function o2oUniqueIndexName(collection, field) {
  const digest = createHash('sha256')
    .update(`${collection}:${field}:o2o`)
    .digest('hex')
    .slice(0, 24);
  return `yuo_${digest}`;
}

export async function createO2ORelation({ database, accountability, input = {} }) {
  assertSchemaManager(accountability);
  const manyCollection = assertIdentifier(input.manyCollection, 'one-to-one source collection');
  const manyField = assertIdentifier(input.manyField, 'one-to-one source field');
  const oneCollection = assertIdentifier(input.oneCollection, 'one-to-one target collection');
  const onDelete = assertOnDelete(input.onDelete);

  return withAdvisoryLock(database, 'yuncms:schema', async (connection) => {
    const metadata = new SchemaMetadataRepository(connection);
    const [manyCollectionMetadata, oneCollectionMetadata] = await Promise.all([
      metadata.readCollection(manyCollection),
      metadata.readCollection(oneCollection),
    ]);

    if (!manyCollectionMetadata || !oneCollectionMetadata) {
      const error = new Error('Both one-to-one collections must exist');
      error.code = 'COLLECTION_NOT_FOUND';
      throw error;
    }
    if (manyCollectionMetadata.system || oneCollectionMetadata.system) {
      const error = new Error('System collections cannot be changed through the dynamic relation API');
      error.code = 'SYSTEM_SCHEMA_READ_ONLY';
      throw error;
    }

    const oneField = input.oneField ?? oneCollectionMetadata.primary_key;
    assertIdentifier(oneField, 'one-to-one target field');
    if (oneField !== oneCollectionMetadata.primary_key) {
      const error = new Error('One-to-one relations must reference the target collection primary key');
      error.code = 'UNSUPPORTED_RELATION_TARGET';
      throw error;
    }

    const [manyFieldMetadata, oneFieldMetadata, existingRelation] = await Promise.all([
      metadata.readField(manyCollection, manyField),
      metadata.readField(oneCollection, oneField),
      metadata.readRelation(manyCollection, manyField),
    ]);
    if (!manyFieldMetadata || !oneFieldMetadata) {
      const error = new Error('Both one-to-one fields must exist in schema metadata');
      error.code = 'FIELD_NOT_FOUND';
      throw error;
    }
    if (existingRelation) {
      const error = new Error(`Relation already exists for ${manyCollection}.${manyField}`);
      error.code = 'RELATION_EXISTS';
      throw error;
    }
    if (manyFieldMetadata.type !== oneFieldMetadata.type) {
      const error = new Error(`Relation field types do not match: ${manyFieldMetadata.type} -> ${oneFieldMetadata.type}`);
      error.code = 'RELATION_TYPE_MISMATCH';
      throw error;
    }
    if (onDelete === 'SET NULL' && Boolean(manyFieldMetadata.required)) {
      const error = new Error('SET NULL cannot be used with a required one-to-one field');
      error.code = 'INVALID_ON_DELETE';
      throw error;
    }

    const fkName = constraintName(manyCollection, manyField, oneCollection);
    const uniqueIndex = o2oUniqueIndexName(manyCollection, manyField);
    const tableSql = quoteIdentifier(manyCollection, 'one-to-one source collection');
    const fieldSql = quoteIdentifier(manyField, 'one-to-one source field');
    const targetTableSql = quoteIdentifier(oneCollection, 'one-to-one target collection');
    const targetFieldSql = quoteIdentifier(oneField, 'one-to-one target field');
    const constraintSql = quoteIdentifier(fkName, 'one-to-one foreign key');
    const uniqueSql = quoteIdentifier(uniqueIndex, 'one-to-one unique index');
    let physicalRelationCreated = false;

    try {
      await connection.query(
        `ALTER TABLE ${tableSql}
         ADD CONSTRAINT ${constraintSql}
           FOREIGN KEY (${fieldSql}) REFERENCES ${targetTableSql} (${targetFieldSql})
           ON DELETE ${onDelete},
         ADD UNIQUE INDEX ${uniqueSql} (${fieldSql})`,
      );
      physicalRelationCreated = true;

      return await withConnectionTransaction(connection, async () => {
        const created = await metadata.createRelation({
          manyCollection,
          manyField,
          oneCollection,
          oneField,
          onDelete,
          metadata: { constraintName: fkName, kind: 'o2o', uniqueIndex },
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
            `ALTER TABLE ${tableSql}
             DROP FOREIGN KEY ${constraintSql},
             DROP INDEX ${uniqueSql}`,
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

export async function deleteO2ORelation({ database, accountability, manyCollection, manyField }) {
  assertSchemaManager(accountability);
  assertIdentifier(manyCollection, 'one-to-one source collection');
  assertIdentifier(manyField, 'one-to-one source field');

  return withAdvisoryLock(database, 'yuncms:schema', async (connection) => {
    const metadata = new SchemaMetadataRepository(connection);
    const relation = await metadata.readRelation(manyCollection, manyField);
    if (!relation) {
      const error = new Error(`Unknown relation: ${manyCollection}.${manyField}`);
      error.code = 'RELATION_NOT_FOUND';
      throw error;
    }

    const relationMetadata = parseMetadata(relation.metadata);
    if (relationMetadata.kind !== 'o2o') {
      const error = new Error(`Relation is not one-to-one: ${manyCollection}.${manyField}`);
      error.code = 'RELATION_TYPE_MISMATCH';
      throw error;
    }

    const tableSql = quoteIdentifier(relation.many_collection, 'one-to-one source collection');
    const fieldSql = quoteIdentifier(relation.many_field, 'one-to-one source field');
    const targetTableSql = quoteIdentifier(relation.one_collection, 'one-to-one target collection');
    const targetFieldSql = quoteIdentifier(relation.one_field, 'one-to-one target field');
    const constraintSql = quoteIdentifier(relationMetadata.constraintName, 'one-to-one foreign key');
    const uniqueSql = quoteIdentifier(
      relationMetadata.uniqueIndex || o2oUniqueIndexName(manyCollection, manyField),
      'one-to-one unique index',
    );

    await connection.query(
      `ALTER TABLE ${tableSql}
       DROP FOREIGN KEY ${constraintSql},
       DROP INDEX ${uniqueSql}`,
    );

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
          `ALTER TABLE ${tableSql}
           ADD CONSTRAINT ${constraintSql}
             FOREIGN KEY (${fieldSql}) REFERENCES ${targetTableSql} (${targetFieldSql})
             ON DELETE ${relation.on_delete},
           ADD UNIQUE INDEX ${uniqueSql} (${fieldSql})`,
        );
      } catch (restoreError) {
        error.restoreError = restoreError;
        error.code ||= 'SCHEMA_PARTIAL_FAILURE';
      }
      throw error;
    }
  });
}
