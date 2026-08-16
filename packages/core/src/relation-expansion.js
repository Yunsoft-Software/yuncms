import { assertIdentifier } from './identifier.js';
import { SchemaCache } from './schema.js';
import { ItemsService } from './services/items-service.js';

const MAX_EXPAND_FIELDS = 8;
const defaultSchemaCache = new SchemaCache();

function expansionError(code, message, path = null) {
  const error = new Error(message);
  error.code = code;
  if (path) error.path = path;
  return error;
}

function normalizeDelimited(value) {
  if (value == null || value === '') return [];
  const values = Array.isArray(value) ? value : String(value).split(',');
  return values.map((entry) => String(entry).trim()).filter(Boolean);
}

export function parseExpandInput(value) {
  const fields = [...new Set(normalizeDelimited(value))];
  if (fields.length > MAX_EXPAND_FIELDS) {
    throw expansionError(
      'INVALID_QUERY',
      `expand supports at most ${MAX_EXPAND_FIELDS} direct relation fields`,
      'expand',
    );
  }

  for (const field of fields) {
    try {
      assertIdentifier(field, 'expand field');
    } catch {
      throw expansionError('INVALID_QUERY', `Invalid expand field: ${field}`, 'expand');
    }
  }
  return fields;
}

function parseRelationMetadata(value) {
  if (value == null || typeof value === 'object') return value ?? {};
  try {
    return JSON.parse(value);
  } catch {
    return {};
  }
}

function withExpansionFields(rawFields, expandFields) {
  if (rawFields == null || rawFields === '') return rawFields;
  const selected = normalizeDelimited(rawFields);
  if (selected.includes('*')) return selected;
  return [...new Set([...selected, ...expandFields])];
}

function withoutExpand(query = {}, expandFields = []) {
  const base = { ...query };
  delete base.expand;
  if (expandFields.length > 0 && Object.hasOwn(base, 'fields')) {
    base.fields = withExpansionFields(base.fields, expandFields);
  }
  return base;
}

async function schemaSnapshot(options) {
  if (options.schema) return options.schema;
  const cache = options.schemaCache ?? defaultSchemaCache;
  return cache.get(options.database);
}

function directRelation(snapshot, collection, field) {
  const relation = snapshot.relationByManyField?.get(`${collection}.${field}`);
  if (!relation) {
    throw expansionError(
      'INVALID_QUERY',
      `Field is not a direct relation and cannot be expanded: ${collection}.${field}`,
      `expand.${field}`,
    );
  }

  const metadata = parseRelationMetadata(relation.metadata);
  if (relation.junction_collection || metadata.kind === 'm2m') {
    throw expansionError(
      'UNSUPPORTED_RELATION_EXPANSION',
      `Only direct M2O fields can be expanded in V1: ${collection}.${field}`,
      `expand.${field}`,
    );
  }
  return relation;
}

async function expandRows({ collection, rows, expandFields, options, ItemsServiceClass }) {
  if (expandFields.length === 0 || rows.length === 0) return rows;
  const snapshot = await schemaSnapshot(options);
  let expandedRows = rows.map((row) => ({ ...row }));

  for (const field of expandFields) {
    const relation = directRelation(snapshot, collection, field);
    const targetCollection = relation.one_collection;
    const targetKey = relation.one_field || snapshot.collections?.[targetCollection]?.primary_key || 'id';
    const values = [...new Set(
      expandedRows
        .map((row) => row[field])
        .filter((value) => value != null && value !== '')
        .map((value) => String(value)),
    )];

    if (values.length === 0) {
      expandedRows = expandedRows.map((row) => ({ ...row, [field]: null }));
      continue;
    }

    const targetService = new ItemsServiceClass(targetCollection, options);
    const targetRows = await targetService.readMany({
      filter: { [targetKey]: { _in: values } },
      limit: Math.min(values.length, 500),
    });

    const byKey = new Map();
    for (const target of targetRows) {
      if (!Object.hasOwn(target, targetKey)) {
        throw expansionError(
          'FORBIDDEN_FIELD',
          `Expanded relation key is not readable: ${targetCollection}.${targetKey}`,
          `expand.${field}`,
        );
      }
      byKey.set(String(target[targetKey]), target);
    }

    expandedRows = expandedRows.map((row) => ({
      ...row,
      [field]: row[field] == null || row[field] === ''
        ? null
        : (byKey.get(String(row[field])) ?? null),
    }));
  }

  return expandedRows;
}

export async function readManyWithRelations({
  collection,
  query = {},
  options = {},
  ItemsServiceClass = ItemsService,
} = {}) {
  assertIdentifier(collection, 'collection name');
  const expandFields = parseExpandInput(query.expand);
  const service = new ItemsServiceClass(collection, options);
  const result = await service.readManyWithMeta(withoutExpand(query, expandFields));
  const data = await expandRows({
    collection,
    rows: result.data,
    expandFields,
    options,
    ItemsServiceClass,
  });
  return { ...result, data };
}

export async function readOneWithRelations({
  collection,
  id,
  query = {},
  options = {},
  ItemsServiceClass = ItemsService,
} = {}) {
  assertIdentifier(collection, 'collection name');
  for (const key of Object.keys(query ?? {})) {
    if (!['fields', 'expand'].includes(key)) {
      throw expansionError('INVALID_QUERY', `Unknown query parameter: ${key}`, key);
    }
  }

  const expandFields = parseExpandInput(query.expand);
  const service = new ItemsServiceClass(collection, options);
  const fields = withExpansionFields(query.fields ?? null, expandFields);
  const record = await service.readOne(id, { fields });
  if (!record) return null;
  const [expanded] = await expandRows({
    collection,
    rows: [record],
    expandFields,
    options,
    ItemsServiceClass,
  });
  return expanded;
}

export { MAX_EXPAND_FIELDS };
