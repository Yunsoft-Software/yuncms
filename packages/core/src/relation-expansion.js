import { assertIdentifier } from './identifier.js';
import { SchemaCache } from './schema.js';
import { ItemsService } from './services/items-service.js';

export const MAX_EXPAND_FIELDS = Number.POSITIVE_INFINITY;
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

function assertFieldToken(field, path) {
  try {
    assertIdentifier(field, 'field');
  } catch {
    throw expansionError('INVALID_QUERY', `Invalid field: ${field}`, path);
  }
  return field;
}

export function parseExpandInput(value) {
  const fields = [...new Set(normalizeDelimited(value))];
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

async function schemaSnapshot(options) {
  if (options.schema) return options.schema;
  const cache = options.schemaCache ?? defaultSchemaCache;
  return cache.get(options.database);
}

function relationFromSnapshot(snapshot, collection, field) {
  return snapshot.relationByManyField?.get(`${collection}.${field}`) ?? null;
}

function isDirectRelation(relation) {
  if (!relation) return false;
  const metadata = parseRelationMetadata(relation.metadata);
  return !relation.junction_collection && metadata.kind !== 'm2m';
}

function directRelation(snapshot, collection, field, path = `fields.${field}`) {
  const relation = relationFromSnapshot(snapshot, collection, field);
  if (!relation) {
    throw expansionError(
      'INVALID_QUERY',
      `Field is not a direct relation and cannot be expanded: ${collection}.${field}`,
      path,
    );
  }

  if (!isDirectRelation(relation)) {
    throw expansionError(
      'UNSUPPORTED_RELATION_EXPANSION',
      `Only direct M2O/O2O fields can be expanded: ${collection}.${field}`,
      path,
    );
  }
  return relation;
}

function readableSourceField(sourceSchema, permission, field) {
  return Boolean(sourceSchema.fields?.[field]
    && (!permission.fields || permission.fields.includes(field)));
}

function directReadableRelationFields(snapshot, collection, sourceSchema, permission) {
  const prefix = `${collection}.`;
  const fields = [];
  for (const [key, relation] of snapshot.relationByManyField?.entries?.() ?? []) {
    if (!key.startsWith(prefix) || !isDirectRelation(relation)) continue;
    const field = key.slice(prefix.length);
    if (readableSourceField(sourceSchema, permission, field)) fields.push(field);
  }
  return [...new Set(fields)];
}

function mergeExpansionSelection(expansions, relationField, targetField) {
  const current = expansions.get(relationField) ?? [];
  if (current.includes('*')) return;
  if (targetField === '*') {
    expansions.set(relationField, ['*']);
    return;
  }
  expansions.set(relationField, [...new Set([...current, targetField])]);
}

function parseFieldsPlan({ value, snapshot, collection, sourceSchema, permission }) {
  const tokens = normalizeDelimited(value);
  if (tokens.length === 0) {
    return { sourceFields: null, expansions: new Map() };
  }

  let sourceAll = false;
  const sourceFields = [];
  const expansions = new Map();

  for (const token of tokens) {
    if (token === '*') {
      sourceAll = true;
      continue;
    }

    if (token === '*.*') {
      sourceAll = true;
      for (const relationField of directReadableRelationFields(
        snapshot,
        collection,
        sourceSchema,
        permission,
      )) {
        mergeExpansionSelection(expansions, relationField, '*');
      }
      continue;
    }

    if (!token.includes('.')) {
      sourceFields.push(assertFieldToken(token, `fields.${token}`));
      continue;
    }

    const parts = token.split('.');
    if (parts.length !== 2 || !parts[0] || !parts[1]) {
      throw expansionError(
        'UNSUPPORTED_RELATION_EXPANSION',
        `Only one relation depth is supported in fields: ${token}`,
        `fields.${token}`,
      );
    }

    const relationField = assertFieldToken(parts[0], `fields.${token}`);
    const targetField = parts[1] === '*'
      ? '*'
      : assertFieldToken(parts[1], `fields.${token}`);

    if (!readableSourceField(sourceSchema, permission, relationField)) {
      throw expansionError('INVALID_QUERY', `Unknown field: ${relationField}`, `fields.${token}`);
    }
    directRelation(snapshot, collection, relationField, `fields.${token}`);
    sourceFields.push(relationField);
    mergeExpansionSelection(expansions, relationField, targetField);
  }

  return {
    sourceFields: sourceAll ? ['*'] : [...new Set(sourceFields)],
    expansions,
  };
}

function addLegacyExpansions({ query, plan, snapshot, collection, sourceSchema, permission }) {
  for (const field of parseExpandInput(query.expand)) {
    if (!readableSourceField(sourceSchema, permission, field)) {
      throw expansionError('INVALID_QUERY', `Unknown field: ${field}`, `expand.${field}`);
    }
    directRelation(snapshot, collection, field, `expand.${field}`);
    mergeExpansionSelection(plan.expansions, field, '*');
    if (plan.sourceFields && !plan.sourceFields.includes('*') && !plan.sourceFields.includes(field)) {
      plan.sourceFields.push(field);
    }
  }
  return plan;
}

async function buildSelectionPlan({ collection, query, options, service }) {
  const snapshot = await schemaSnapshot(options);
  const sourceSchema = snapshot.collections?.[collection];
  if (!sourceSchema) {
    throw expansionError('COLLECTION_NOT_FOUND', `Unknown collection: ${collection}`);
  }

  const permission = await service.resolvePermission('read');
  const plan = parseFieldsPlan({
    value: query.fields,
    snapshot,
    collection,
    sourceSchema,
    permission,
  });
  addLegacyExpansions({ query, plan, snapshot, collection, sourceSchema, permission });
  return { ...plan, snapshot };
}

function baseQuery(query, sourceFields) {
  const base = { ...query };
  delete base.expand;
  if (sourceFields == null) delete base.fields;
  else base.fields = sourceFields;
  return base;
}

function targetQueryFields(selection, targetKey) {
  if (selection.includes('*')) return ['*'];
  return [...new Set([...selection, targetKey])];
}

function projectTarget(target, selection) {
  if (selection.includes('*')) return target;
  return Object.fromEntries(
    selection
      .filter((field) => Object.hasOwn(target, field))
      .map((field) => [field, target[field]]),
  );
}

async function expandRows({ collection, rows, expansions, options, ItemsServiceClass, snapshot }) {
  if (expansions.size === 0 || rows.length === 0) return rows;
  const effectiveSnapshot = snapshot ?? await schemaSnapshot(options);
  let expandedRows = rows.map((row) => ({ ...row }));

  for (const [field, selection] of expansions) {
    const relation = directRelation(effectiveSnapshot, collection, field);
    const targetCollection = relation.one_collection;
    const targetKey = relation.one_field
      || effectiveSnapshot.collections?.[targetCollection]?.primary_key
      || 'id';
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
      fields: targetQueryFields(selection, targetKey),
      filter: { [targetKey]: { _in: values } },
      limit: Math.min(values.length, 500),
    });

    const byKey = new Map();
    for (const target of targetRows) {
      if (!Object.hasOwn(target, targetKey)) {
        throw expansionError(
          'FORBIDDEN_FIELD',
          `Expanded relation key is not readable: ${targetCollection}.${targetKey}`,
          `fields.${field}`,
        );
      }
      byKey.set(String(target[targetKey]), projectTarget(target, selection));
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
  const service = new ItemsServiceClass(collection, options);
  const plan = await buildSelectionPlan({ collection, query, options, service });
  const result = await service.readManyWithMeta(baseQuery(query, plan.sourceFields));
  const data = await expandRows({
    collection,
    rows: result.data,
    expansions: plan.expansions,
    options,
    ItemsServiceClass,
    snapshot: plan.snapshot,
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

  const service = new ItemsServiceClass(collection, options);
  const plan = await buildSelectionPlan({ collection, query, options, service });
  const record = await service.readOne(id, { fields: plan.sourceFields });
  if (!record) return null;
  const [expanded] = await expandRows({
    collection,
    rows: [record],
    expansions: plan.expansions,
    options,
    ItemsServiceClass,
    snapshot: plan.snapshot,
  });
  return expanded;
}
