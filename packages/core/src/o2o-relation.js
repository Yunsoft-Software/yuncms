import { createHash } from 'node:crypto';

import { withAdvisoryLock } from './advisory-lock.js';
import { assertIdentifier, quoteIdentifier } from './identifier.js';
import { SchemaMetadataRepository } from './schema-metadata-repository.js';
import { incrementSchemaVersion } from './schema-version.js';
import { withConnectionTransaction } from './transaction.js';
import { RelationsService } from './services/relations-service.js';
import { assertSchemaManager } from './services/schema-access.js';

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

export function o2oUniqueIndexName(collection, field) {
  const digest = createHash('sha256')
    .update(`${collection}:${field}:o2o`)
    .digest('hex')
    .slice(0, 24);
  return `yuo_${digest}`;
}

function relationServiceOptions({ database, accountability }) {
  return { database, accountability };
}

export async function createO2ORelation({ database, accountability, input = {} }) {
  assertSchemaManager(accountability);
  const manyCollection = assertIdentifier(input.manyCollection, 'one-to-one source collection');
  const manyField = assertIdentifier(input.manyField, 'one-to-one source field');
  const service = new RelationsService(relationServiceOptions({ database, accountability }));
  await service.createM2O(input);

  const uniqueIndex = o2oUniqueIndexName(manyCollection, manyField);
  const tableSql = quoteIdentifier(manyCollection, 'one-to-one source collection');
  const fieldSql = quoteIdentifier(manyField, 'one-to-one source field');
  const uniqueSql = quoteIdentifier(uniqueIndex, 'one-to-one unique index');

  try {
    return await withAdvisoryLock(database, 'yuncms:schema', async (connection) => {
      const metadata = new SchemaMetadataRepository(connection);
      const relation = await metadata.readRelation(manyCollection, manyField);
      if (!relation) {
        const error = new Error(`Relation metadata disappeared: ${manyCollection}.${manyField}`);
        error.code = 'SCHEMA_METADATA_DRIFT';
        throw error;
      }

      let uniqueCreated = false;
      try {
        await connection.query(`ALTER TABLE ${tableSql} ADD UNIQUE INDEX ${uniqueSql} (${fieldSql})`);
        uniqueCreated = true;

        return await withConnectionTransaction(connection, async () => {
          const relationMetadata = {
            ...parseMetadata(relation.metadata),
            kind: 'o2o',
            uniqueIndex,
          };
          await connection.query(
            `UPDATE yuncms_relations
             SET metadata = ?
             WHERE many_collection = ? AND many_field = ?`,
            [JSON.stringify(relationMetadata), manyCollection, manyField],
          );
          const schemaVersion = await incrementSchemaVersion(connection);
          const upgraded = await metadata.readRelation(manyCollection, manyField);
          return { ...upgraded, schemaVersion };
        });
      } catch (error) {
        if (uniqueCreated) {
          try {
            await connection.query(`ALTER TABLE ${tableSql} DROP INDEX ${uniqueSql}`);
          } catch (cleanupError) {
            error.cleanupError = cleanupError;
            error.code ||= 'SCHEMA_PARTIAL_FAILURE';
          }
        }
        throw error;
      }
    });
  } catch (error) {
    try {
      await service.deleteM2O(manyCollection, manyField);
    } catch (cleanupError) {
      error.cleanupError = cleanupError;
      error.code ||= 'SCHEMA_PARTIAL_FAILURE';
    }
    throw error;
  }
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
    const constraintSql = quoteIdentifier(relationMetadata.constraintName, 'relation constraint');
    const uniqueSql = quoteIdentifier(
      relationMetadata.uniqueIndex || o2oUniqueIndexName(manyCollection, manyField),
      'one-to-one unique index',
    );

    await connection.query(`ALTER TABLE ${tableSql} DROP FOREIGN KEY ${constraintSql}`);
    try {
      await connection.query(`ALTER TABLE ${tableSql} DROP INDEX ${uniqueSql}`);
    } catch (error) {
      try {
        await connection.query(
          `ALTER TABLE ${tableSql}
           ADD CONSTRAINT ${constraintSql}
           FOREIGN KEY (${fieldSql}) REFERENCES ${targetTableSql} (${targetFieldSql})
           ON DELETE ${relation.on_delete}`,
        );
      } catch (restoreError) {
        error.restoreError = restoreError;
        error.code ||= 'SCHEMA_PARTIAL_FAILURE';
      }
      throw error;
    }

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
      const restoreErrors = [];
      try {
        await connection.query(`ALTER TABLE ${tableSql} ADD UNIQUE INDEX ${uniqueSql} (${fieldSql})`);
      } catch (restoreError) {
        restoreErrors.push(restoreError);
      }
      try {
        await connection.query(
          `ALTER TABLE ${tableSql}
           ADD CONSTRAINT ${constraintSql}
           FOREIGN KEY (${fieldSql}) REFERENCES ${targetTableSql} (${targetFieldSql})
           ON DELETE ${relation.on_delete}`,
        );
      } catch (restoreError) {
        restoreErrors.push(restoreError);
      }
      if (restoreErrors.length > 0) {
        error.restoreErrors = restoreErrors;
        error.code ||= 'SCHEMA_PARTIAL_FAILURE';
      }
      throw error;
    }
  });
}
