import { assertIdentifier, quoteIdentifier } from './identifier.js';
import {
  assertQueryCost,
  compileFilter,
  compileSelectFields,
  QUERY_LIMITS,
} from './query.js';
import { SchemaCache } from './schema.js';
import { ItemsService } from './services/items-service.js';

export const MAX_EXPAND_FIELDS = QUERY_LIMITS.maxRelationExpansions;
export const MAX_RELATION_DEPTH = QUERY_LIMITS.maxRelationDepth;
export const MAX_TO_MANY_ROWS = 2_000;
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

function relationKind(relation) {
  return parseRelationMetadata(relation?.metadata).kind ?? 'm2o';
}

function readableSourceField(sourceSchema, permission, field) {
  return Boolean(sourceSchema.fields?.[field] && (!permission.fields || permission.fields.includes(field)));
}

function safeVirtualAlias(value) {
  if (typeof value !== 'string' || value.length > 64) return null;
  try { return assertIdentifier(value, 'relation alias'); } catch { return null; }
}

function chooseVirtualAlias({ preferred, fallback, used, relationId }) {
  const candidates = [preferred, fallback, `${fallback}_${relationId ?? 'relation'}`]
    .map(safeVirtualAlias)
    .filter(Boolean);
  for (const candidate of candidates) {
    if (!used.has(candidate)) {
      used.add(candidate);
      return candidate;
    }
  }
  return null;
}

function companionM2MRelation(snapshot, relation) {
  return snapshot.relations?.find((candidate) => (
    candidate.junction_collection === relation.junction_collection
    && candidate.many_collection === relation.junction_collection
    && candidate.many_field === relation.junction_field
  )) ?? null;
}

export function relationDescriptorsForCollection(snapshot, collection) {
  const sourceSchema = snapshot.collections?.[collection];
  if (!sourceSchema) return new Map();
  const descriptors = new Map();
  const used = new Set(Object.keys(sourceSchema.fields ?? {}));
  const directPrefix = `${collection}.`;

  for (const [key, relation] of snapshot.relationByManyField?.entries?.() ?? []) {
    if (!key.startsWith(directPrefix) || !isDirectRelation(relation)) continue;
    const field = key.slice(directPrefix.length);
    descriptors.set(field, Object.freeze({
      alias: field,
      kind: 'to_one',
      sourceCollection: collection,
      sourceField: field,
      sourceKey: field,
      targetCollection: relation.one_collection,
      targetKey: relation.one_field || snapshot.collections?.[relation.one_collection]?.primary_key || 'id',
      relation,
      edge: `to_one:${collection}.${field}`,
    }));
  }

  const virtualCandidates = [];
  for (const relation of snapshot.relations ?? []) {
    if (relation.one_collection !== collection) continue;
    const metadata = parseRelationMetadata(relation.metadata);

    if (relation.junction_collection && metadata.kind === 'm2m') {
      const companion = companionM2MRelation(snapshot, relation);
      if (!companion || companion.one_collection === collection) continue;
      virtualCandidates.push({
        preferred: metadata.reverseField ?? metadata.alias ?? companion.one_collection,
        fallback: `${companion.one_collection}_${relation.junction_collection}`,
        relationId: relation.id,
        descriptor: {
          kind: 'm2m',
          sourceCollection: collection,
          sourceKey: relation.one_field || sourceSchema.primary_key || 'id',
          targetCollection: companion.one_collection,
          targetKey: companion.one_field || snapshot.collections?.[companion.one_collection]?.primary_key || 'id',
          junctionCollection: relation.junction_collection,
          sourceJunctionField: relation.many_field,
          targetJunctionField: relation.junction_field,
          relation,
          edge: `m2m:${relation.junction_collection}:${relation.many_field}`,
        },
      });
      continue;
    }

    if (!isDirectRelation(relation) || relation.many_collection === collection) continue;
    const kind = relationKind(relation) === 'o2o' ? 'reverse_to_one' : 'o2m';
    virtualCandidates.push({
      preferred: metadata.reverseField ?? metadata.alias ?? relation.many_collection,
      fallback: `${relation.many_collection}_${relation.many_field}`,
      relationId: relation.id,
      descriptor: {
        kind,
        sourceCollection: collection,
        sourceKey: relation.one_field || sourceSchema.primary_key || 'id',
        targetCollection: relation.many_collection,
        targetKey: snapshot.collections?.[relation.many_collection]?.primary_key || 'id',
        targetForeignKey: relation.many_field,
        relation,
        edge: `${kind}:${relation.many_collection}.${relation.many_field}`,
      },
    });
  }

  virtualCandidates.sort((left, right) => left.descriptor.edge.localeCompare(right.descriptor.edge));
  for (const candidate of virtualCandidates) {
    const alias = chooseVirtualAlias({ ...candidate, used });
    if (!alias) continue;
    descriptors.set(alias, Object.freeze({ ...candidate.descriptor, alias }));
  }

  return descriptors;
}

function relationDescriptor(snapshot, collection, field, path = `fields.${field}`) {
  const descriptor = relationDescriptorsForCollection(snapshot, collection).get(field);
  if (!descriptor) {
    throw expansionError('INVALID_QUERY', `Field is not a relation and cannot be expanded: ${collection}.${field}`, path);
  }
  return descriptor;
}

function createPlanNode() {
  return {
    all: false,
    explicit: false,
    fields: new Set(),
    internalFields: new Set(),
    children: new Map(),
    relations: new Map(),
  };
}

function countChildren(node) {
  let count = node.children.size;
  for (const child of node.children.values()) count += countChildren(child);
  return count;
}

function countToMany(node) {
  let count = 0;
  for (const [alias, child] of node.children) {
    const kind = node.relations.get(alias)?.kind;
    if (kind === 'o2m' || kind === 'm2m') count += 1;
    count += countToMany(child);
  }
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
  const descriptor = relationDescriptor(snapshot, collection, field, path);
  if (visited.has(descriptor.edge)) throw expansionError('INVALID_QUERY', `Cyclic relation path is not allowed: ${path}`, path);
  node.relations.set(field, descriptor);
  if (descriptor.kind !== 'to_one') node.internalFields.add(descriptor.sourceKey);
  const child = node.children.get(field) ?? createPlanNode();
  child.explicit = true;
  node.children.set(field, child);
  addPath({
    node: child,
    snapshot,
    collection: descriptor.targetCollection,
    parts: rest,
    path,
    depth: depth + 1,
    visited: new Set([...visited, descriptor.edge]),
  });
}

function relationAllowedAtRoot(descriptor, sourceSchema, permission) {
  const requiredField = descriptor.kind === 'to_one' ? descriptor.sourceField : descriptor.sourceKey;
  return readableSourceField(sourceSchema, permission, requiredField);
}

function parseFieldsPlan({ value, snapshot, collection, sourceSchema, permission }) {
  const tokens = normalizeDelimited(value);
  const root = createPlanNode();
  root.explicit = tokens.length > 0;
  if (tokens.length === 0) return root;

  for (const token of tokens) {
    if (token === '*') { root.all = true; continue; }
    if (token === '*.*') {
      root.all = true;
      for (const [alias, descriptor] of relationDescriptorsForCollection(snapshot, collection)) {
        if (!relationAllowedAtRoot(descriptor, sourceSchema, permission)) continue;
        root.relations.set(alias, descriptor);
        if (descriptor.kind !== 'to_one') root.internalFields.add(descriptor.sourceKey);
        const child = root.children.get(alias) ?? createPlanNode();
        child.all = true;
        child.explicit = true;
        root.children.set(alias, child);
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
    const descriptor = relationDescriptor(snapshot, collection, parts[0], `fields.${token}`);
    if (!relationAllowedAtRoot(descriptor, sourceSchema, permission)) {
      throw expansionError('INVALID_QUERY', `Relation source key is not readable: ${parts[0]}`, `fields.${token}`);
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
    const descriptor = relationDescriptor(snapshot, collection, field, `expand.${field}`);
    if (!relationAllowedAtRoot(descriptor, sourceSchema, permission)) {
      throw expansionError('INVALID_QUERY', `Relation source key is not readable: ${field}`, `expand.${field}`);
    }
    root.relations.set(field, descriptor);
    if (descriptor.kind !== 'to_one') root.internalFields.add(descriptor.sourceKey);
    const child = root.children.get(field) ?? createPlanNode();
    child.all = true;
    child.explicit = true;
    root.children.set(field, child);
  }
  if (countChildren(root) > MAX_EXPAND_FIELDS) {
    throw expansionError('INVALID_QUERY', `Relation expansion cannot contain more than ${MAX_EXPAND_FIELDS} relation nodes`, 'expand');
  }
  return root;
}

function visibleSelectionForNode(node) {
  if (node.all) return ['*'];
  const fields = new Set(node.fields);
  for (const [alias] of node.children) {
    const descriptor = node.relations.get(alias);
    if (descriptor?.kind === 'to_one') fields.add(descriptor.sourceField);
  }
  return [...fields];
}

function baseSelectionForNode(node) {
  const visible = visibleSelectionForNode(node);
  if (visible.includes('*')) return visible;
  return [...new Set([...visible, ...node.internalFields])];
}

async function buildSelectionPlan({ collection, query, options, service }) {
  const snapshot = await schemaSnapshot(options);
  const sourceSchema = snapshot.collections?.[collection];
  if (!sourceSchema) throw expansionError('COLLECTION_NOT_FOUND', `Unknown collection: ${collection}`);
  const permission = await service.resolvePermission('read');
  const root = parseFieldsPlan({ value: query.fields, snapshot, collection, sourceSchema, permission });
  addLegacyExpansions({ query, root, snapshot, collection, sourceSchema, permission });
  const relationCount = countChildren(root);
  const toManyCount = countToMany(root);
  const relationDepth = maxPlanDepth(root);
  assertQueryCost(
    { ...query, limit: Number(query.limit ?? QUERY_LIMITS.defaultLimit) },
    { relationCount: relationCount + toManyCount, relationDepth },
  );
  return { root, snapshot };
}

function maxPlanDepth(node) {
  if (node.children.size === 0) return 0;
  return 1 + Math.max(...[...node.children.values()].map(maxPlanDepth));
}

function baseQuery(query, root) {
  const base = { ...query };
  delete base.expand;
  const selection = baseSelectionForNode(root);
  if (selection.length === 0) delete base.fields;
  else base.fields = selection;
  return base;
}

function projectTarget(target, node, visibleFields) {
  const projectedFields = node.all
    ? [...new Set([...visibleFields, ...node.children.keys()])]
    : [...new Set([...node.fields, ...node.children.keys()])];
  return Object.fromEntries(
    projectedFields.filter((field) => Object.hasOwn(target, field)).map((field) => [field, target[field]]),
  );
}

function schemaForFields(schema, allowedFields) {
  if (allowedFields == null) return schema;
  return {
    ...schema,
    fields: Object.fromEntries(
      allowedFields.filter((field) => schema.fields[field]).map((field) => [field, schema.fields[field]]),
    ),
  };
}

function combineCompiledFilters(...filters) {
  const active = filters.filter((filter) => filter?.sql);
  if (active.length === 0) return { sql: '', params: [] };
  return {
    sql: ` WHERE ${active.map((filter) => `(${filter.sql.replace(/^ WHERE /, '')})`).join(' AND ')}`,
    params: active.flatMap((filter) => filter.params),
  };
}

async function readRowsByLookup({
  service,
  fields,
  internalFields = [],
  lookupField,
  values,
  maxRows = MAX_TO_MANY_ROWS,
}) {
  if (!Array.isArray(values) || values.length === 0) return { data: [], visibleFields: [] };
  const schema = await service.getCollectionSchema();
  if (!schema.fields?.[lookupField]) {
    throw expansionError('INVALID_QUERY', `Unknown relation lookup field: ${lookupField}`, lookupField);
  }
  const permission = await service.resolvePermission('read');
  const accessSchema = schemaForFields(schema, permission.fields);
  let visibleFields = [];
  if (fields?.includes('*')) {
    visibleFields = Object.keys(accessSchema.fields);
  } else if (Array.isArray(fields) && fields.length > 0) {
    visibleFields = compileSelectFields(fields, accessSchema).fields;
  }
  const trustedInternal = [...new Set([lookupField, ...internalFields])];
  for (const field of trustedInternal) {
    if (!schema.fields?.[field]) throw expansionError('INVALID_QUERY', `Unknown internal relation field: ${field}`, field);
  }
  const internalSchema = {
    ...accessSchema,
    fields: {
      ...accessSchema.fields,
      ...Object.fromEntries(trustedInternal.map((field) => [field, schema.fields[field]])),
    },
  };
  const selection = compileSelectFields([...new Set([...visibleFields, ...trustedInternal])], internalSchema);
  const permissionFilter = compileFilter(permission.filter, schema, {
    dynamicVariables: {
      user: service.accountability?.user ?? null,
      role: service.accountability?.role ?? null,
      now: new Date(),
    },
  });
  const table = quoteIdentifier(service.collection, 'collection name');
  const data = [];

  for (let offset = 0; offset < values.length; offset += QUERY_LIMITS.maxInValues) {
    const chunk = values.slice(offset, offset + QUERY_LIMITS.maxInValues);
    const filter = combineCompiledFilters(
      permissionFilter,
      compileFilter({ [lookupField]: { _in: chunk } }, schema),
    );
    const remaining = maxRows - data.length;
    if (remaining <= 0) throw expansionError('QUERY_RELATION_ROW_LIMIT', `Relation expansion cannot load more than ${maxRows} rows`);
    const [rows] = await service.database.query(
      `SELECT ${selection.sql} FROM ${table}${filter.sql} LIMIT ?`,
      [...filter.params, remaining + 1],
    );
    data.push(...rows);
    if (data.length > maxRows) {
      throw expansionError('QUERY_RELATION_ROW_LIMIT', `Relation expansion cannot load more than ${maxRows} rows`);
    }
  }
  return { data, visibleFields };
}

async function expandToOne({ rows, field, childNode, descriptor, options, ItemsServiceClass, snapshot, depth }) {
  const values = [...new Set(rows
    .map((row) => row[descriptor.sourceField])
    .filter((value) => value != null && value !== '')
    .map((value) => String(value)))];
  if (values.length === 0) return rows.map((row) => ({ ...row, [field]: null }));

  const targetService = new ItemsServiceClass(descriptor.targetCollection, options);
  const targetResult = await targetService.readManyForRelation({
    fields: [...new Set([...visibleSelectionForNode(childNode), ...childNode.internalFields])],
    lookupField: descriptor.targetKey,
    values,
  });
  const nestedTargets = await expandRows({
    collection: descriptor.targetCollection,
    rows: targetResult.data,
    node: childNode,
    options,
    ItemsServiceClass,
    snapshot,
    depth: depth + 1,
  });
  const byKey = new Map();
  for (const target of nestedTargets) {
    if (!Object.hasOwn(target, descriptor.targetKey)) {
      throw expansionError('FORBIDDEN_FIELD', `Expanded relation key is not readable: ${descriptor.targetCollection}.${descriptor.targetKey}`, `fields.${field}`);
    }
    byKey.set(String(target[descriptor.targetKey]), projectTarget(target, childNode, targetResult.visibleFields));
  }
  return rows.map((row) => ({
    ...row,
    [field]: row[descriptor.sourceField] == null || row[descriptor.sourceField] === ''
      ? null
      : (byKey.get(String(row[descriptor.sourceField])) ?? null),
  }));
}

async function expandReverse({ rows, field, childNode, descriptor, options, ItemsServiceClass, snapshot, depth }) {
  const values = [...new Set(rows
    .map((row) => row[descriptor.sourceKey])
    .filter((value) => value != null && value !== '')
    .map((value) => String(value)))];
  if (values.length === 0) {
    const empty = descriptor.kind === 'reverse_to_one' ? null : [];
    return rows.map((row) => ({ ...row, [field]: empty }));
  }
  const targetService = new ItemsServiceClass(descriptor.targetCollection, options);
  const targetResult = await readRowsByLookup({
    service: targetService,
    fields: visibleSelectionForNode(childNode),
    internalFields: [...childNode.internalFields, descriptor.targetKey],
    lookupField: descriptor.targetForeignKey,
    values,
  });
  const nestedTargets = await expandRows({
    collection: descriptor.targetCollection,
    rows: targetResult.data,
    node: childNode,
    options,
    ItemsServiceClass,
    snapshot,
    depth: depth + 1,
  });
  const grouped = new Map();
  for (const target of nestedTargets) {
    const sourceValue = target[descriptor.targetForeignKey];
    if (sourceValue == null) continue;
    const key = String(sourceValue);
    const list = grouped.get(key) ?? [];
    list.push(projectTarget(target, childNode, targetResult.visibleFields));
    grouped.set(key, list);
  }
  return rows.map((row) => {
    const matches = grouped.get(String(row[descriptor.sourceKey])) ?? [];
    return {
      ...row,
      [field]: descriptor.kind === 'reverse_to_one' ? (matches[0] ?? null) : matches,
    };
  });
}

async function expandM2M({ rows, field, childNode, descriptor, options, ItemsServiceClass, snapshot, depth }) {
  const values = [...new Set(rows
    .map((row) => row[descriptor.sourceKey])
    .filter((value) => value != null && value !== '')
    .map((value) => String(value)))];
  if (values.length === 0) return rows.map((row) => ({ ...row, [field]: [] }));

  const junctionService = new ItemsServiceClass(descriptor.junctionCollection, options);
  const junction = await readRowsByLookup({
    service: junctionService,
    fields: [],
    internalFields: [descriptor.sourceJunctionField, descriptor.targetJunctionField],
    lookupField: descriptor.sourceJunctionField,
    values,
  });
  const targetValues = [...new Set(junction.data
    .map((row) => row[descriptor.targetJunctionField])
    .filter((value) => value != null && value !== '')
    .map((value) => String(value)))];
  if (targetValues.length === 0) return rows.map((row) => ({ ...row, [field]: [] }));

  const targetService = new ItemsServiceClass(descriptor.targetCollection, options);
  const targetResult = await targetService.readManyForRelation({
    fields: [...new Set([...visibleSelectionForNode(childNode), ...childNode.internalFields])],
    lookupField: descriptor.targetKey,
    values: targetValues,
  });
  const nestedTargets = await expandRows({
    collection: descriptor.targetCollection,
    rows: targetResult.data,
    node: childNode,
    options,
    ItemsServiceClass,
    snapshot,
    depth: depth + 1,
  });
  const byTarget = new Map();
  for (const target of nestedTargets) {
    if (!Object.hasOwn(target, descriptor.targetKey)) continue;
    byTarget.set(String(target[descriptor.targetKey]), projectTarget(target, childNode, targetResult.visibleFields));
  }
  const grouped = new Map();
  for (const link of junction.data) {
    const sourceValue = link[descriptor.sourceJunctionField];
    const targetValue = link[descriptor.targetJunctionField];
    if (sourceValue == null || targetValue == null) continue;
    const target = byTarget.get(String(targetValue));
    if (!target) continue;
    const key = String(sourceValue);
    const list = grouped.get(key) ?? [];
    list.push(target);
    grouped.set(key, list);
  }
  return rows.map((row) => ({
    ...row,
    [field]: grouped.get(String(row[descriptor.sourceKey])) ?? [],
  }));
}

async function expandRows({ collection, rows, node, options, ItemsServiceClass, snapshot, depth = 0 }) {
  if (node.children.size === 0 || rows.length === 0) return rows;
  if (depth >= MAX_RELATION_DEPTH) {
    throw expansionError('QUERY_RELATION_DEPTH_LIMIT', `Relation depth cannot exceed ${MAX_RELATION_DEPTH}`);
  }
  let expandedRows = rows.map((row) => ({ ...row }));

  for (const [field, childNode] of node.children) {
    const descriptor = node.relations.get(field) ?? relationDescriptor(snapshot, collection, field);
    if (descriptor.kind === 'to_one') {
      expandedRows = await expandToOne({ rows: expandedRows, field, childNode, descriptor, options, ItemsServiceClass, snapshot, depth });
    } else if (descriptor.kind === 'm2m') {
      expandedRows = await expandM2M({ rows: expandedRows, field, childNode, descriptor, options, ItemsServiceClass, snapshot, depth });
    } else {
      expandedRows = await expandReverse({ rows: expandedRows, field, childNode, descriptor, options, ItemsServiceClass, snapshot, depth });
    }
  }
  return expandedRows;
}

function stripRootInternalFields(rows, root) {
  if (root.all || root.internalFields.size === 0) return rows;
  return rows.map((row) => {
    const copy = { ...row };
    for (const field of root.internalFields) {
      if (!root.fields.has(field)) delete copy[field];
    }
    return copy;
  });
}

export async function readManyWithRelations({ collection, query = {}, options = {}, ItemsServiceClass = ItemsService } = {}) {
  assertIdentifier(collection, 'collection name');
  const service = new ItemsServiceClass(collection, options);
  const plan = await buildSelectionPlan({ collection, query, options, service });
  const result = await service.readManyWithMeta(baseQuery(query, plan.root));
  const expanded = await expandRows({ collection, rows: result.data, node: plan.root, options, ItemsServiceClass, snapshot: plan.snapshot });
  return { ...result, data: stripRootInternalFields(expanded, plan.root) };
}

export async function readOneWithRelations({ collection, id, query = {}, options = {}, ItemsServiceClass = ItemsService } = {}) {
  assertIdentifier(collection, 'collection name');
  for (const key of Object.keys(query ?? {})) {
    if (!['fields', 'expand'].includes(key)) throw expansionError('INVALID_QUERY', `Unknown query parameter: ${key}`, key);
  }
  const service = new ItemsServiceClass(collection, options);
  const plan = await buildSelectionPlan({ collection, query, options, service });
  const selection = baseSelectionForNode(plan.root);
  const record = await service.readOne(id, { fields: selection.length === 0 ? null : selection });
  if (!record) return null;
  const [expanded] = await expandRows({ collection, rows: [record], node: plan.root, options, ItemsServiceClass, snapshot: plan.snapshot });
  return stripRootInternalFields([expanded], plan.root)[0];
}
