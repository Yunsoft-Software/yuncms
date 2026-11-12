import { SchemaMetadataRepository } from './schema-metadata-repository.js';
import { currentLocalSchemaEpoch, readSchemaVersion } from './schema-version.js';

export const SCHEMA_SNAPSHOT = Symbol.for('yuncms.schemaSnapshot');

const NATIVE_USER_COLUMNS = new Set([
  'id',
  'email',
  'role',
  'status',
  'email_verified_at',
  'last_access',
  'created_at',
  'updated_at',
]);

const NATIVE_FILE_COLUMNS = new Set([
  'id',
  'filename_download',
  'title',
  'mimetype',
  'filesize',
  'uploaded_by',
  'uploaded_at',
  'metadata',
]);

function isUserExtensionField(field) {
  if (!field?.field || field.field === 'password_hash') return false;
  const meta = typeof field.schema_metadata === 'string'
    ? (() => {
      try {
        return JSON.parse(field.schema_metadata);
      } catch {
        return {};
      }
    })()
    : (field.schema_metadata ?? {});
  return meta?.systemExtension === true;
}

export function attachSchemaSnapshot(collectionSchema, snapshot) {
  if (!collectionSchema || typeof collectionSchema !== 'object' || !snapshot) return collectionSchema;
  if (collectionSchema[SCHEMA_SNAPSHOT] === snapshot) return collectionSchema;
  const target = Object.isExtensible(collectionSchema) ? collectionSchema : { ...collectionSchema };
  Object.defineProperty(target, SCHEMA_SNAPSHOT, {
    value: snapshot,
    enumerable: false,
    configurable: true,
  });
  return target;
}

export function lookupManyToOneRelation(snapshot, collection, field) {
  if (!snapshot || !collection || !field) return null;
  const key = `${collection}.${field}`;
  if (snapshot.relationByManyField instanceof Map) {
    return snapshot.relationByManyField.get(key) ?? null;
  }
  if (Array.isArray(snapshot.relations)) {
    return snapshot.relations.find(
      (relation) => relation.many_collection === collection && relation.many_field === field,
    ) ?? null;
  }
  return null;
}

export function relationTargetSchema(snapshot, oneCollection) {
  const fullSchema = snapshot?.collections?.[oneCollection];
  if (!fullSchema) return null;
  if (!fullSchema.system) return attachSchemaSnapshot(fullSchema, snapshot);
  if (oneCollection === 'yuncms_users') {
    const fields = Object.fromEntries(
      Object.entries(fullSchema.fields ?? {}).filter(
        ([name, field]) => NATIVE_USER_COLUMNS.has(name) || isUserExtensionField(field),
      ),
    );
    return attachSchemaSnapshot({ ...fullSchema, fields }, snapshot);
  }
  if (oneCollection === 'yuncms_files') {
    const fields = Object.fromEntries(
      Object.entries(fullSchema.fields ?? {}).filter(([name]) => NATIVE_FILE_COLUMNS.has(name)),
    );
    return attachSchemaSnapshot({ ...fullSchema, fields }, snapshot);
  }
  return null;
}

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

  const collectionObjects = Object.fromEntries(
    collections.map((collection) => [
      collection.collection,
      {
        ...collection,
        fields: Object.freeze(
          Object.fromEntries(
            (fieldsByCollection.get(collection.collection) ?? []).map((field) => [field.field, field]),
          ),
        ),
      },
    ]),
  );

  const snapshot = {
    version,
    collections: Object.freeze(collectionObjects),
    relations: Object.freeze(relations),
    relationByManyField,
  };

  for (const collectionObject of Object.values(collectionObjects)) {
    Object.defineProperty(collectionObject, SCHEMA_SNAPSHOT, {
      value: snapshot,
      enumerable: false,
    });
    Object.freeze(collectionObject);
  }

  return Object.freeze(snapshot);
}

export class SchemaCache {
  constructor({ versionCheckTtlMs = 250 } = {}) {
    this.versionCheckTtlMs = versionCheckTtlMs;
    this.snapshot = null;
    this.lastVersionCheckAt = 0;
    this.seenLocalEpoch = -1;
  }

  async get(database, { force = false } = {}) {
    const now = Date.now();
    const localEpoch = currentLocalSchemaEpoch();

    if (
      !force
      && this.snapshot
      && this.seenLocalEpoch === localEpoch
      && now - this.lastVersionCheckAt < this.versionCheckTtlMs
    ) {
      return this.snapshot;
    }

    const currentVersion = await readSchemaVersion(database);
    this.lastVersionCheckAt = now;
    this.seenLocalEpoch = localEpoch;

    if (!force && this.snapshot?.version === currentVersion) {
      return this.snapshot;
    }

    const snapshot = await loadSchemaSnapshot(database);
    this.snapshot = snapshot;
    this.lastVersionCheckAt = Date.now();
    this.seenLocalEpoch = currentLocalSchemaEpoch();
    return snapshot;
  }

  clear() {
    this.snapshot = null;
    this.lastVersionCheckAt = 0;
    this.seenLocalEpoch = -1;
  }
}
