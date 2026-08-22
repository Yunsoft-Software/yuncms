import { assertIdentifier } from './identifier.js';
import { assertQueryCost, QUERY_LIMITS } from './query.js';
import { SchemaCache } from './schema.js';
import { ItemsService } from './services/items-service.js';

export const MAX_EXPAND_FIELDS = QUERY_LIMITS.maxRelationExpansions;
export const MAX_RELATION_DEPTH = QUERY_LIMITS.maxRelationDepth;
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
  try { assertIdentifier(field, 'field'); } catch { throw expansionError('INVALID_QUERY', `Invalid field: ${field}`, path); }
  return field;
}

export function parseExpandInput(value) {
  const fields = [...new Set(normalizeDelimited(value))];
  if (fields.length > MAX_EXPAND_FIELDS) {
    throw expansionError('INVALID_QUERY', `expand cannot contain more than ${MAX_EXPAND_FIELDS} entries`, 'expand');
  }
  for (const field of fields) {
    try { assertIdentifier(field, 'expand field'); } catch { throw expansionError('INVALID_QUERY', `Invalid expand field: ${field}`, 'expand'); }
  }
  return fields;
}

function parseRelationMetadata(value) {
  if (value == null || typeof value === 'object') return value ?? {};
  try { return JSON.parse(value); } catch { return {}; }
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
  if (!relation) throw expansionError('INVALID_QUERY', `Field is not a direct relation and cannot be expanded: ${collection}.${field}`, path);
  if (!isDirectRelation(relation)) {
    throw expansionError('UNSUPPORTED_RELATION_EXPANSION', `Only direct M2O/O2O fields can be expanded through this field: ${collection}.${field}`, path);
  }
  return relation;
}

function readableSourceField(sourceSchema, permission, field) {
  return Boolean(sourceSchema.fields?.[field] && (!permission.fields || permission.fields.includes(field)));
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

function createPlanNode() {
  return { all: false, fields: new Set(), children: new Map() };
}

function countChildren(node) {
  let count = node.children.size;
  for (const child of node.children.values()) count += countChildren(child);
  return count;
}

function addPath({ node, snapshot, collection, parts, path, depth = 0, visited = new Set() }) {
  if (parts.length === 0) return;
  const [head, ...rest] = parts;
  if (rest.length === 0) {
    if (head === '*') node.all = true;
    else node.fields.add(assertFieldToken(head, path));
    return;
  }
  if (depth >= MAX_RELATION_DEPTH) {
    throw expansionError('QUERY_RELATION_DEPTH_LIMIT', `Relation depth cannot exceed ${MAX_RELATION_DEPTH}`, path);
  }
  const field = assertFieldToken(head, path);
  const relation = directRelation(snapshot, collection, field, path);
  const edge = `${collection}.${field}`;
  if (visited.has(edge)) throw expansionError('INVALID_QUERY', `Cyclic relation path is not allowed: ${path}`, path);
  const child = node.children.get(field) ?? createPlanNode();
  node.children.set(field, child);
  addPath({
    node: child,
    snapshot,
    collection: relation.one_collection,
    parts: rest,
    path,
    depth: depth + 1,
    visited: new Set([...visited, edge]),
  });
}

function parseFieldsPlan({ value, snapshot, collection, sourceSchema, permission }) {
  const tokens = normalizeDelimited(value);
  const root = createPlanNode();
  if (tokens.length === 0) return root;

  for (const token of tokens) {
    if (token === '*') { root.all = true; continue; }
    if (token === '*.*') {
      root.all = true;
      for (const relationField of directReadableRelationFields(snapshot, collection, sourceSchema, permission)) {
        const child = root.children.get(relationField) ?? createPlanNode();
        child.all = true;
        root.children.set(relationField, child);
      }
      continue;
    }

    const parts = token.split('.');
    if (parts.some((part) => !part)) throw expansionError('INVALID_QUERY', `Invalid fields path: ${token}`, `fields.${token}`);
    if (parts.length === 1) {
      if (!readableSourceField(sourceSchema, permission, parts[0])) {
        throw expansionError('INVALID_QUERY', `Unknown field: ${parts[0]}`, `fields.${token}`);
      }
      root.fields.add(assertFieldToken(parts[0], `fields.${token}`));
      continue;
    }
    const relationField = parts[0];
    if (!readableSourceField(sourceSchema, permission, relationField)) {
      throw expansionError('INVALID_QUERY', `Unknown field: ${relationField}`, `fields.${token}`);
    }
    addPath({ node: root, snapshot, collection, parts, path: `fields.${token}` });
  }

  const relationCount = countChildren(root);
  if (relationCount > MAX_EXPAND_FIELDS) {
    throw expansionError('INVALID_QUERY', `Relation expansion cannot contain more than ${MAX_EXPAND_FIELDS} relation nodes`, 'fields');
  }
  return root;
}

function addLegacyExpansions({ query, root, snapshot, collection, sourceSchema, permission }) {
  for (const field of parseExpandInput(query.expand)) {
    if (!readableSourceField(sourceSchema, permission, field)) throw expansionError('INVALID_QUERY', `Unknown field: ${field}`, `expand.${field}`);
    directRelation(snapshot, collection, field, `expand.${field}`);
    const child = root.children.get(field) ?? createPlanNode();
    child.all = true;
    root.children.set(field, child);
  }
  if (countChildren(root) > MAX_EXPAND_FIELDS) {
    throw expansionError('INVALID_QUERY', `Relation expansion cannot contain more than ${MAX_EXPAND_FIELDS} relation nodes`, 'expand');
  }
  return root;
}

function selectionForNode(node) {
  if (node.all) return ['*'];
  return [...new Set([...node.fields, ...node.children.keys()])];
}

async function buildSelectionPlan({ collection, query, options, service }) {
  const snapshot = await schemaSnapshot(options);
  const sourceSchema = snapshot.collections?.[collection];
  if (!sourceSchema) throw expansionError('COLLECTION_NOT_FOUND', `Unknown collection: ${collection}`);
  const permission = await service.resolvePermission('read');
  const root = parseFieldsPlan({ value: query.fields, snapshot, collection, sourceSchema, permission });
  addLegacyExpansions({ query, root, snapshot, collection, sourceSchema, permission });
  const relationCount = countChildren(root);
  const relationDepth = maxPlanDepth(root);
  assertQueryCost({ ...query, limit: Number(query.limit ?? QUERY_LIMITS.defaultLimit) }, { relationCount, relationDepth });
  return { root, snapshot };
}

function maxPlanDepth(node) {
  if (node.children.size === 0) return 0;
  return 1 + Math.max(...[...node.children.values()].map(maxPlanDepth));
}

function baseQuery(query, root) {
  const base = { ...query };
  delete base.expand;
  const selection = selectionForNode(root);
  if (selection.length === 0) delete base.fields;
  else base.fields = selection;
  return base;
}

function projectTarget(target, node, visibleFields) {
  const projectedFields = node.all ? visibleFields : [...new Set([...node.fields, ...node.children.keys()])];
  return Object.fromEntries(
    projectedFields.filter((field) => Object.hasOwn(target, field)).map((field) => [field, target[field]]),
  );
}

async function expandRows({ collection, rows, node, options, ItemsServiceClass, snapshot, depth = 0 }) {
  if (node.children.size === 0 || rows.length === 0) return rows;
  if (depth >= MAX_RELATION_DEPTH) {
    throw expansionError('QUERY_RELATION_DEPTH_LIMIT', `Relation depth cannot exceed ${MAX_RELATION_DEPTH}`);
  }
  let expandedRows = rows.map((row) => ({ ...row }));

  for (const [field, childNode] of node.children) {
    const relation = directRelation(snapshot, collection, field);
    const targetCollection = relation.one_collection;
    const targetKey = relation.one_field || snapshot.collections?.[targetCollection]?.primary_key || 'id';
    const values = [...new Set(expandedRows
      .map((row) => row[field])
      .filter((value) => value != null && value !== '')
      .map((value) => String(value)))];

    if (values.length === 0) {
      expandedRows = expandedRows.map((row) => ({ ...row, [field]: null }));
      continue;
    }

    const targetService = new ItemsServiceClass(targetCollection, options);
    const targetResult = await targetService.readManyForRelation({
      fields: selectionForNode(childNode),
      lookupField: targetKey,
      values,
    });
    const nestedTargets = await expandRows({
      collection: targetCollection,
      rows: targetResult.data,
      node: childNode,
      options,
      ItemsServiceClass,
      snapshot,
      depth: depth + 1,
    });

    const byKey = new Map();
    for (const target of nestedTargets) {
      if (!Object.hasOwn(target, targetKey)) {
        throw expansionError('FORBIDDEN_FIELD', `Expanded relation key is not readable: ${targetCollection}.${targetKey}`, `fields.${field}`);
      }
      byKey.set(String(target[targetKey]), projectTarget(target, childNode, targetResult.visibleFields));
    }
    expandedRows = expandedRows.map((row) => ({
      ...row,
      [field]: row[field] == null || row[field] === '' ? null : (byKey.get(String(row[field])) ?? null),
    }));
  }
  return expandedRows;
}

export async function readManyWithRelations({ collection, query = {}, options = {}, ItemsServiceClass = ItemsService } = {}) {
  assertIdentifier(collection, 'collection name');
  const service = new ItemsServiceClass(collection, options);
  const plan = await buildSelectionPlan({ collection, query, options, service });
  const result = await service.readManyWithMeta(baseQuery(query, plan.root));
  const data = await expandRows({ collection, rows: result.data, node: plan.root, options, ItemsServiceClass, snapshot: plan.snapshot });
  return { ...result, data };
}

export async function readOneWithRelations({ collection, id, query = {}, options = {}, ItemsServiceClass = ItemsService } = {}) {
  assertIdentifier(collection, 'collection name');
  for (const key of Object.keys(query ?? {})) {
    if (!['fields', 'expand'].includes(key)) throw expansionError('INVALID_QUERY', `Unknown query parameter: ${key}`, key);
  }
  const service = new ItemsServiceClass(collection, options);
  const plan = await buildSelectionPlan({ collection, query, options, service });
  const selection = selectionForNode(plan.root);
  const record = await service.readOne(id, { fields: selection.length === 0 ? null : selection });
  if (!record) return null;
  const [expanded] = await expandRows({ collection, rows: [record], node: plan.root, options, ItemsServiceClass, snapshot: plan.snapshot });
  return expanded;
}
