import { SchemaMetadataRepository } from './schema-metadata-repository.js';
import { readSchemaVersion } from './schema-version.js';

export async function loadSchemaSnapshot(database) {
  const version = await readSchemaVersion(database);
  const repository = new SchemaMetadataRepository(database);
  const [collections, relations] = await Promise.all([
    repository.listCollections(),
    repository.listRelations(),
  ]);

  const fieldsByCollection = new Map();
  await Promise.all(
    collections.map(async (collection) => {
      fieldsByCollection.set(
        collection.collection,
        await repository.listFields(collection.collection),
      );
    }),
  );

  const relationByManyField = new Map(
    relations.map((relation) => [
      `${relation.many_collection}.${relation.many_field}`,
      relation,
    ]),
  );

  return Object.freeze({
    version,
    collections: Object.freeze(
      Object.fromEntries(
        collections.map((collection) => [
          collection.collection,
          Object.freeze({
            ...collection,
            fields: Object.freeze(
              Object.fromEntries(
                (fieldsByCollection.get(collection.collection) ?? []).map((field) => [field.field, field]),
              ),
            ),
          }),
        ]),
      ),
    ),
    relations: Object.freeze(relations),
    relationByManyField,
  });
}

export class SchemaCache {
  constructor({ versionCheckTtlMs = 250 } = {}) {
    this.versionCheckTtlMs = versionCheckTtlMs;
    this.snapshot = null;
    this.lastVersionCheckAt = 0;
  }

  async get(database, { force = false } = {}) {
    const now = Date.now();

    if (!force && this.snapshot && now - this.lastVersionCheckAt < this.versionCheckTtlMs) {
      return this.snapshot;
    }

    const currentVersion = await readSchemaVersion(database);
    this.lastVersionCheckAt = now;

    if (!force && this.snapshot?.version === currentVersion) {
      return this.snapshot;
    }

    const snapshot = await loadSchemaSnapshot(database);
    this.snapshot = snapshot;
    this.lastVersionCheckAt = Date.now();
    return snapshot;
  }

  clear() {
    this.snapshot = null;
    this.lastVersionCheckAt = 0;
  }
}
