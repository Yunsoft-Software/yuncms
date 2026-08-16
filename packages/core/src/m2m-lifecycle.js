import { randomBytes } from 'node:crypto';

import { withAdvisoryLock } from './advisory-lock.js';
import { assertIdentifier, quoteIdentifier } from './identifier.js';
import { SchemaMetadataRepository } from './schema-metadata-repository.js';
import { incrementSchemaVersion } from './schema-version.js';
import { assertSchemaManager } from './services/schema-authorization.js';
import { withConnectionTransaction } from './transaction.js';

function lifecycleError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function parseMetadata(value) {
  if (value == null || typeof value === 'object') return value ?? {};
  try {
    return JSON.parse(value);
  } catch {
    return {};
  }
}

function tombstoneName(collection) {
  const suffix = randomBytes(6).toString('hex');
  return `ydel_${collection.slice(0, Math.max(1, 46 - suffix.length))}_${suffix}`;
}

export async function deleteM2MJunction({
  database,
  accountability,
  junctionCollection,
  destructive = false,
} = {}) {
  assertSchemaManager(accountability);
  if (!database) throw new Error('Database handle is required');
  assertIdentifier(junctionCollection, 'junction collection');
  if (destructive !== true) {
    throw lifecycleError(
      'DESTRUCTIVE_OPERATION_REQUIRED',
      'M2M junction deletion requires destructive: true',
    );
  }

  return withAdvisoryLock(database, 'yuncms:schema', async (connection) => {
    const metadata = new SchemaMetadataRepository(connection);
    const [collection, allRelations] = await Promise.all([
      metadata.readCollection(junctionCollection),
      metadata.listRelations(),
    ]);

    if (!collection) {
      throw lifecycleError('COLLECTION_NOT_FOUND', `Unknown junction collection: ${junctionCollection}`);
    }
    if (collection.system) {
      throw lifecycleError('SYSTEM_SCHEMA_READ_ONLY', 'System collections cannot be deleted as M2M junctions');
    }

    const relations = allRelations.filter((relation) => relation.junction_collection === junctionCollection);
    const m2mRelations = relations.filter((relation) => parseMetadata(relation.metadata).kind === 'm2m');
    if (m2mRelations.length !== 2 || relations.length !== 2) {
      throw lifecycleError(
        'M2M_JUNCTION_INVALID',
        `Collection ${junctionCollection} is not a complete YunCMS M2M junction`,
      );
    }

    const relationFields = new Set(m2mRelations.map((relation) => relation.many_field));
    if (relationFields.size !== 2 || m2mRelations.some((relation) => relation.many_collection !== junctionCollection)) {
      throw lifecycleError(
        'M2M_JUNCTION_INVALID',
        `M2M junction ${junctionCollection} has inconsistent relation metadata`,
      );
    }

    const tombstone = tombstoneName(junctionCollection);
    const tableSql = quoteIdentifier(junctionCollection, 'junction collection');
    const tombstoneSql = quoteIdentifier(tombstone, 'junction tombstone');
    await connection.query(`RENAME TABLE ${tableSql} TO ${tombstoneSql}`);

    let committed = false;
    try {
      const result = await withConnectionTransaction(connection, async () => {
        for (const relation of m2mRelations) {
          const deleted = await metadata.deleteRelation(relation.many_collection, relation.many_field);
          if (deleted !== 1) {
            throw lifecycleError(
              'SCHEMA_METADATA_DRIFT',
              `M2M relation metadata disappeared during delete: ${relation.many_collection}.${relation.many_field}`,
            );
          }
        }

        await connection.query('DELETE FROM yuncms_permissions WHERE collection = ?', [junctionCollection]);
        const deletedCollection = await metadata.deleteCollection(junctionCollection);
        if (deletedCollection !== 1) {
          throw lifecycleError(
            'SCHEMA_METADATA_DRIFT',
            `M2M junction metadata disappeared during delete: ${junctionCollection}`,
          );
        }
        const schemaVersion = await incrementSchemaVersion(connection);
        return {
          deleted: true,
          junctionCollection,
          relations: m2mRelations,
          schemaVersion,
        };
      });
      committed = true;

      try {
        await connection.query(`DROP TABLE ${tombstoneSql}`);
      } catch (cleanupError) {
        const error = lifecycleError(
          'SCHEMA_PARTIAL_FAILURE',
          `M2M junction was logically deleted but tombstone cleanup failed: ${tombstone}`,
        );
        error.cleanupError = cleanupError;
        error.cleanupObject = tombstone;
        error.result = result;
        throw error;
      }

      return result;
    } catch (error) {
      if (!committed) {
        try {
          await connection.query(`RENAME TABLE ${tombstoneSql} TO ${tableSql}`);
        } catch (restoreError) {
          error.restoreError = restoreError;
          error.code ||= 'SCHEMA_PARTIAL_FAILURE';
        }
      }
      throw error;
    }
  });
}
