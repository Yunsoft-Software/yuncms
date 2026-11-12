import { quoteIdentifier } from './identifier.js';
import { resolveDynamicVariables } from './dynamic-variables.js';
import { lookupManyToOneRelation, relationTargetSchema, SCHEMA_SNAPSHOT } from './schema.js';

const QUERY_KEYS = new Set(['fields', 'filter', 'sort', 'limit', 'offset', 'search', 'aggregate', 'groupBy']);
const FILTER_OPERATORS = new Set([
  '_eq', '_neq', '_lt', '_lte', '_gt', '_gte',
  '_in', '_nin', '_null', '_nnull',
  '_contains', '_starts_with', '_ends_with',
]);
const AGGREGATE_FUNCTIONS = new Set(['count', 'countDistinct', 'sum', 'avg', 'min', 'max']);
const SEARCHABLE_TYPES = new Set(['string', 'text']);

export const QUERY_LIMITS = Object.freeze({
  defaultLimit: 100,
  maxLimit: 500,
  maxFields: 100,
  maxRelationExpansions: 20,
  maxRelationDepth: 4,
  maxSortFields: 20,
  maxOffset: 1_000_000,
  maxFilterDepth: 8,
  maxFilterNodes: 100,
  maxInValues: 100,
  maxSearchLength: 200,
  maxAggregateFields: 20,
  maxGroupByFields: 10,
  maxCost: 2_000,
});

function queryError(message, path = null, code = 'INVALID_QUERY') {
  const error = new Error(message);
  error.code = code;
  if (path) error.path = path;
  return error;
}

function normalizeDelimited(value, label, { maxItems }) {
  if (value == null || value === '') return null;
  const values = Array.isArray(value) ? value : String(value).split(',');
  const normalized = values.map((item) => String(item).trim()).filter(Boolean);
  if (normalized.length === 0) throw queryError(`${label} cannot be empty`, label);
  if (normalized.length > maxItems) {
    throw queryError(`${label} cannot contain more than ${maxItems} entries`, label);
  }
  return normalized;
}

function normalizeInteger(value, fallback, { label, min, max }) {
  if (value == null || value === '') return fallback;
  if (typeof value === 'object' || typeof value === 'boolean') {
    throw queryError(`${label} must be an integer between ${min} and ${max}`, label);
  }
  const number = Number(value);
  if (!Number.isInteger(number) || number < min || number > max) {
    throw queryError(`${label} must be an integer between ${min} and ${max}`, label);
  }
  return number;
}

function normalizeFilter(value) {
  if (value == null || value === '') return null;
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('not an object');
      return parsed;
    } catch {
      throw queryError('filter must be a valid JSON object', 'filter');
    }
  }
  if (typeof value !== 'object' || Array.isArray(value)) throw queryError('filter must be an object', 'filter');
  return value;
}

function normalizeSearch(value, limits) {
  if (value == null || value === '') return null;
  if (Array.isArray(value) || typeof value === 'object') throw queryError('search must be a string', 'search');
  const search = String(value).trim();
  if (!search) return null;
  if (search.length > limits.maxSearchLength) {
    throw queryError(`search cannot exceed ${limits.maxSearchLength} characters`, 'search');
  }
  return search;
}

function normalizeAggregate(value, limits) {
  if (value == null || value === '') return null;
  let aggregate = value;
  if (typeof aggregate === 'string') {
    try { aggregate = JSON.parse(aggregate); } catch { throw queryError('aggregate must be a JSON object', 'aggregate'); }
  }
  if (!aggregate || typeof aggregate !== 'object' || Array.isArray(aggregate)) {
    throw queryError('aggregate must be an object', 'aggregate');
  }

  const normalized = {};
  let count = 0;
  for (const [fn, rawFields] of Object.entries(aggregate)) {
    if (!AGGREGATE_FUNCTIONS.has(fn)) throw queryError(`Unknown aggregate function: ${fn}`, `aggregate.${fn}`);
    const fields = normalizeDelimited(rawFields, `aggregate.${fn}`, { maxItems: limits.maxAggregateFields });
    if (!fields) throw queryError(`aggregate.${fn} cannot be empty`, `aggregate.${fn}`);
    count += fields.length;
    if (count > limits.maxAggregateFields) {
      throw queryError(`aggregate cannot contain more than ${limits.maxAggregateFields} fields`, 'aggregate');
    }
    normalized[fn] = fields;
  }
  if (Object.keys(normalized).length === 0) throw queryError('aggregate cannot be empty', 'aggregate');
  return normalized;
}

export function parseItemsQuery(raw = {}, options = {}) {
  const limits = { ...QUERY_LIMITS, ...options };
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw queryError('Query must be an object');

  for (const key of Object.keys(raw)) {
    if (!QUERY_KEYS.has(key)) throw queryError(`Unknown query parameter: ${key}`, key);
  }

  const filter = normalizeFilter(raw.filter);
  if (filter) assertFilterBudget(filter, limits);

  const query = {
    fields: normalizeDelimited(raw.fields, 'fields', { maxItems: limits.maxFields }),
    filter,
    sort: normalizeDelimited(raw.sort, 'sort', { maxItems: limits.maxSortFields }),
    limit: normalizeInteger(raw.limit, limits.defaultLimit, { label: 'limit', min: 1, max: limits.maxLimit }),
    offset: normalizeInteger(raw.offset, 0, { label: 'offset', min: 0, max: limits.maxOffset }),
    search: normalizeSearch(raw.search, limits),
    aggregate: normalizeAggregate(raw.aggregate, limits),
    groupBy: normalizeDelimited(raw.groupBy, 'groupBy', { maxItems: limits.maxGroupByFields }),
  };

  if (query.groupBy && !query.aggregate) throw queryError('groupBy requires aggregate', 'groupBy');
  return Object.freeze(query);
}

export function isRelationalFilterKey(key) {
  return key === '_and' || key === '_or' || !key.startsWith('_');
}

export function assertFilterBudget(filter, options = {}) {
  if (filter == null) return null;
  const maxFilterDepth = options.maxFilterDepth ?? QUERY_LIMITS.maxFilterDepth;
  const maxFilterNodes = options.maxFilterNodes ?? QUERY_LIMITS.maxFilterNodes;
  const allowRelational = options.allowRelational !== false;
  const rootPath = options.path ?? 'filter';

  let nodes = 0;
  const stack = [{ node: filter, path: rootPath, depth: 1 }];

  while (stack.length > 0) {
    const { node, path, depth } = stack.pop();
    if (!node || typeof node !== 'object' || Array.isArray(node)) {
      throw queryError('Filter node must be an object', path);
    }
    if (depth > maxFilterDepth) {
      throw queryError(`Filter depth cannot exceed ${maxFilterDepth}`, path);
    }
    nodes += 1;
    if (nodes > maxFilterNodes) {
      throw queryError(`Filter cannot contain more than ${maxFilterNodes} nodes`, path);
    }

    const entries = Object.entries(node);
    if (entries.length === 0) {
      throw queryError('Filter cannot be empty', path);
    }
    if (entries.length > maxFilterNodes) {
      throw queryError(`Filter cannot contain more than ${maxFilterNodes} nodes`, path);
    }

    const nextFrames = [];
    for (const [key, value] of entries) {
      if (key === '_and' || key === '_or') {
        if (!Array.isArray(value) || value.length === 0) {
          throw queryError(`${key} requires a non-empty array`, `${path}.${key}`);
        }
        const boundedLength = Math.min(value.length, maxFilterNodes + 1);
        for (let index = 0; index < boundedLength; index += 1) {
          nextFrames.push({
            node: value[index],
            path: `${path}.${key}.${index}`,
            depth: depth + 1,
          });
        }
        continue;
      }

      if (!value || typeof value !== 'object' || Array.isArray(value)) {
        throw queryError('Field filters must be operator objects', `${path}.${key}`);
      }
      const fieldEntries = Object.entries(value);
      if (fieldEntries.length === 0) {
        throw queryError('Field filter cannot be empty', `${path}.${key}`);
      }
      if (fieldEntries.length > maxFilterNodes) {
        throw queryError(`Filter cannot contain more than ${maxFilterNodes} nodes`, `${path}.${key}`);
      }

      const relationalEntries = [];
      for (const [subKey, subValue] of fieldEntries) {
        if (FILTER_OPERATORS.has(subKey)) continue;
        if (allowRelational && isRelationalFilterKey(subKey)) {
          relationalEntries.push([subKey, subValue]);
        }
      }
      if (relationalEntries.length > 0) {
        nextFrames.push({
          node: Object.fromEntries(relationalEntries),
          path: `${path}.${key}`,
          depth: depth + 1,
        });
      }
    }

    for (let index = nextFrames.length - 1; index >= 0; index -= 1) {
      stack.push(nextFrames[index]);
    }
  }

  return filter;
}

function filterRelationStats(rootNode) {
  const state = { count: 0, maxDepth: 0, visited: 0 };
  if (!rootNode || typeof rootNode !== 'object' || Array.isArray(rootNode)) return state;
  const stack = [{ node: rootNode, depth: 1, relationDepth: 0 }];
  while (stack.length > 0) {
    const { node, depth, relationDepth } = stack.pop();
    if (!node || typeof node !== 'object' || Array.isArray(node)) continue;
    if (depth > QUERY_LIMITS.maxFilterDepth) continue;
    state.visited += 1;
    if (state.visited > QUERY_LIMITS.maxFilterNodes) break;
    for (const [key, value] of Object.entries(node)) {
      if (key === '_and' || key === '_or') {
        if (Array.isArray(value)) {
          const boundedLength = Math.min(value.length, QUERY_LIMITS.maxFilterNodes);
          for (let index = boundedLength - 1; index >= 0; index -= 1) {
            stack.push({ node: value[index], depth: depth + 1, relationDepth });
          }
        }
        continue;
      }
      if (!value || typeof value !== 'object' || Array.isArray(value)) continue;
      const relationalEntries = Object.entries(value).filter(([subKey]) => isRelationalFilterKey(subKey));
      if (relationalEntries.length === 0) continue;
      const nextRelationDepth = relationDepth + 1;
      state.count += 1;
      if (nextRelationDepth > state.maxDepth) state.maxDepth = nextRelationDepth;
      if (nextRelationDepth < QUERY_LIMITS.maxRelationDepth) {
        stack.push({
          node: Object.fromEntries(relationalEntries),
          depth: depth + 1,
          relationDepth: nextRelationDepth,
        });
      }
    }
  }
  return state;
}

export function queryCost(query, { relationDepth = 0, relationCount = 0 } = {}) {
  const filterRelations = query?.filter ? filterRelationStats(query.filter) : { count: 0, maxDepth: 0 };
  let cost = 1 + Number(query?.limit ?? QUERY_LIMITS.defaultLimit);
  cost += (query?.fields?.length ?? 0) * 2;
  cost += (query?.sort?.length ?? 0) * 5;
  cost += (relationCount + filterRelations.count) * 50;
  cost += Math.max(relationDepth, filterRelations.maxDepth) * 100;
  if (query?.search) cost += 100;
  if (query?.aggregate) cost += 250 + Object.values(query.aggregate).flat().length * 25;
  return cost;
}

export function assertQueryCost(query, options = {}) {
  const maxCost = options.maxCost ?? QUERY_LIMITS.maxCost;
  const cost = queryCost(query, options);
  if (cost > maxCost) throw queryError(`Query cost ${cost} exceeds limit ${maxCost}`, null, 'QUERY_COST_LIMIT');
  return cost;
}

function resolveField(schema, field, path = field) {
  if (!schema?.fields?.[field]) throw queryError(`Unknown field: ${field}`, path);
  return schema.fields[field];
}

export function compileSelectFields(fields, schema) {
  const selected = !fields || fields.includes('*') ? Object.keys(schema.fields) : fields;
  if (selected.length === 0) throw queryError('At least one field must be selected', 'fields');
  const unique = [...new Set(selected)];
  return {
    fields: unique,
    sql: unique.map((field) => {
      resolveField(schema, field, `fields.${field}`);
      return quoteIdentifier(field, 'field name');
    }).join(', '),
  };
}

export function compileSort(sort, schema) {
  if (!sort) return '';
  const parts = sort.map((entry, index) => {
    const descending = entry.startsWith('-');
    const field = descending ? entry.slice(1) : entry;
    if (!field) throw queryError('Sort field cannot be empty', `sort.${index}`);
    resolveField(schema, field, `sort.${index}`);
    return `${quoteIdentifier(field, 'field name')} ${descending ? 'DESC' : 'ASC'}`;
  });
  return parts.length ? ` ORDER BY ${parts.join(', ')}` : '';
}

function escapeLike(value) {
  return String(value).replace(/[\\%_]/g, '\\$&');
}

export function compileSearch(search, schema) {
  if (!search) return { sql: '', params: [] };
  const fields = Object.entries(schema?.fields ?? {})
    .filter(([, field]) => SEARCHABLE_TYPES.has(field.type))
    .map(([name]) => name);
  if (fields.length === 0) return { sql: ' WHERE 0 = 1', params: [] };
  const needle = `%${escapeLike(search)}%`;
  return {
    sql: ` WHERE (${fields.map((field) => `${quoteIdentifier(field, 'field name')} LIKE ? ESCAPE '\\\\'`).join(' OR ')})`,
    params: fields.map(() => needle),
  };
}

export function compileAggregate(aggregate, groupBy, schema) {
  if (!aggregate) return null;
  const groups = groupBy ?? [];
  for (const field of groups) resolveField(schema, field, `groupBy.${field}`);
  const selections = groups.map((field) => quoteIdentifier(field, 'field name'));
  const aliases = new Set(groups);

  for (const [fn, fields] of Object.entries(aggregate)) {
    for (const field of fields) {
      if (field === '*' && fn !== 'count') throw queryError(`${fn} does not support *`, `aggregate.${fn}`);
      if (field !== '*') resolveField(schema, field, `aggregate.${fn}.${field}`);
      const column = field === '*' ? '*' : quoteIdentifier(field, 'field name');
      const sqlFn = fn === 'countDistinct' ? 'COUNT' : fn.toUpperCase();
      const expression = fn === 'countDistinct' ? `${sqlFn}(DISTINCT ${column})` : `${sqlFn}(${column})`;
      const rawAlias = field === '*' ? fn : `${fn}_${field}`;
      let alias = rawAlias;
      let suffix = 2;
      while (aliases.has(alias)) alias = `${rawAlias}_${suffix++}`;
      aliases.add(alias);
      selections.push(`${expression} AS ${quoteIdentifier(alias, 'aggregate alias')}`);
    }
  }
  return {
    sql: selections.join(', '),
    groupSql: groups.length ? ` GROUP BY ${groups.map((field) => quoteIdentifier(field, 'field name')).join(', ')}` : '',
  };
}

function datetimeFilterValue(value, path, { allowUnresolvedDynamicVariables = false } = {}) {
  // Schema-only permission validation keeps recognized dynamic values unresolved.
  // resolveDynamicVariables already validates their syntax before compilation.
  if (allowUnresolvedDynamicVariables && typeof value === 'string'
    && (value === '$NOW' || value.toUpperCase().startsWith('$NOW('))) return value;
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime()) || value.getUTCFullYear() < 1000 || value.getUTCFullYear() > 9999) {
      throw queryError('Invalid datetime filter value', path);
    }
    return value;
  }
  const match = typeof value === 'string'
    ? /^(\d{4})-(\d{2})-(\d{2})([T ])(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,6}))?(Z|[+-]\d{2}:\d{2})?$/u.exec(value)
    : null;
  if (!match || (match[4] === 'T' ? !match[9] : Boolean(match[9]))) {
    throw queryError('Datetime filters require a timezone-bearing ISO value or a MySQL datetime', path);
  }
  const [, year, month, day, , hour, minute, second, , zone] = match;
  const daysInMonth = new Date(Date.UTC(Number(year), Number(month), 0)).getUTCDate();
  if (Number(year) < 1000 || Number(month) < 1 || Number(month) > 12
    || Number(day) < 1 || Number(day) > daysInMonth
    || Number(hour) > 23 || Number(minute) > 59 || Number(second) > 59) {
    throw queryError('Invalid datetime filter value', path);
  }
  if (!zone) return value;
  const date = new Date(value);
  if (Number.isNaN(date.getTime()) || date.getUTCFullYear() < 1000 || date.getUTCFullYear() > 9999) {
    throw queryError('Invalid datetime filter value', path);
  }
  return date;
}

function compileOperator(fieldSql, operator, value, path, limits, field) {
  if (!FILTER_OPERATORS.has(operator)) throw queryError(`Unknown filter operator: ${operator}`, path);
  const temporal = field.type === 'datetime' || field.type === 'timestamp';
  const normalize = (entry) => temporal ? datetimeFilterValue(entry, path, limits) : entry;
  switch (operator) {
    case '_eq':
      if (value === null) throw queryError('Use _null for NULL comparisons', path);
      return { sql: `${fieldSql} = ?`, params: [normalize(value)] };
    case '_neq':
      if (value === null) throw queryError('Use _nnull for NULL comparisons', path);
      return { sql: `${fieldSql} <> ?`, params: [normalize(value)] };
    case '_lt': return { sql: `${fieldSql} < ?`, params: [normalize(value)] };
    case '_lte': return { sql: `${fieldSql} <= ?`, params: [normalize(value)] };
    case '_gt': return { sql: `${fieldSql} > ?`, params: [normalize(value)] };
    case '_gte': return { sql: `${fieldSql} >= ?`, params: [normalize(value)] };
    case '_in':
    case '_nin': {
      if (!Array.isArray(value)) throw queryError(`${operator} requires an array`, path);
      if (value.length > limits.maxInValues) throw queryError(`${operator} accepts at most ${limits.maxInValues} values`, path);
      if (value.length === 0) return { sql: operator === '_in' ? '0 = 1' : '1 = 1', params: [] };
      const placeholders = value.map(() => '?').join(', ');
      return { sql: `${fieldSql} ${operator === '_in' ? 'IN' : 'NOT IN'} (${placeholders})`, params: value.map(normalize) };
    }
    case '_null':
    case '_nnull': {
      if (typeof value !== 'boolean') throw queryError(`${operator} requires a boolean`, path);
      const wantsNull = operator === '_null' ? value : !value;
      return { sql: `${fieldSql} IS ${wantsNull ? '' : 'NOT '}NULL`, params: [] };
    }
    case '_contains': return { sql: `${fieldSql} LIKE ? ESCAPE '\\\\'`, params: [`%${escapeLike(value)}%`] };
    case '_starts_with': return { sql: `${fieldSql} LIKE ? ESCAPE '\\\\'`, params: [`${escapeLike(value)}%`] };
    case '_ends_with': return { sql: `${fieldSql} LIKE ? ESCAPE '\\\\'`, params: [`%${escapeLike(value)}`] };
    default: throw queryError(`Unknown filter operator: ${operator}`, path);
  }
}

function compileFilterObject(
  filter,
  schema,
  path,
  limits,
  state,
  depth,
  relationDepth = 0,
  qualifier = null,
  snapshot = null,
) {
  if (!filter || typeof filter !== 'object' || Array.isArray(filter)) throw queryError('Filter node must be an object', path);
  if (depth > limits.maxFilterDepth) throw queryError(`Filter depth cannot exceed ${limits.maxFilterDepth}`, path);
  state.nodes += 1;
  if (state.nodes > limits.maxFilterNodes) throw queryError(`Filter cannot contain more than ${limits.maxFilterNodes} nodes`, path);

  const fragments = [];
  const params = [];
  for (const [key, value] of Object.entries(filter)) {
    if (key === '_and' || key === '_or') {
      if (!Array.isArray(value) || value.length === 0) throw queryError(`${key} requires a non-empty array`, `${path}.${key}`);
      const children = value.map((child, index) => compileFilterObject(
        child,
        schema,
        `${path}.${key}.${index}`,
        limits,
        state,
        depth + 1,
        relationDepth,
        qualifier,
        snapshot,
      ));
      fragments.push(`(${children.map((child) => child.sql).join(key === '_and' ? ' AND ' : ' OR ')})`);
      for (const child of children) params.push(...child.params);
      continue;
    }
    const field = resolveField(schema, key, `${path}.${key}`);
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw queryError('Field filters must be operator objects', `${path}.${key}`);
    const entries = Object.entries(value);
    if (entries.length === 0) throw queryError('Field filter cannot be empty', `${path}.${key}`);

    const scalarEntries = [];
    const relationalEntries = [];
    for (const [subKey, subValue] of entries) {
      if (FILTER_OPERATORS.has(subKey)) {
        scalarEntries.push([subKey, subValue]);
      } else if (isRelationalFilterKey(subKey)) {
        relationalEntries.push([subKey, subValue]);
      } else {
        throw queryError(`Unknown filter operator: ${subKey}`, `${path}.${key}.${subKey}`);
      }
    }

    const fieldSql = qualifier
      ? `${qualifier}.${quoteIdentifier(key, 'field name')}`
      : quoteIdentifier(key, 'field name');
    const fieldFragments = [];
    for (const [operator, operatorValue] of scalarEntries) {
      const compiled = compileOperator(fieldSql, operator, operatorValue, `${path}.${key}.${operator}`, limits, field);
      fieldFragments.push(compiled.sql);
      params.push(...compiled.params);
    }

    if (relationalEntries.length > 0) {
      const relation = limits.allowRelational !== false && schema?.collection
        ? lookupManyToOneRelation(snapshot, schema.collection, key)
        : null;
      if (!relation) {
        const [firstKey] = relationalEntries[0];
        throw queryError(`Unknown filter operator: ${firstKey}`, `${path}.${key}.${firstKey}`);
      }
      const nextRelationDepth = relationDepth + 1;
      if (nextRelationDepth > limits.maxRelationDepth) {
        throw queryError(`Filter relation depth cannot exceed ${limits.maxRelationDepth}`, `${path}.${key}`);
      }
      const baseTargetSchema = relationTargetSchema(snapshot, relation.one_collection);
      if (!baseTargetSchema) {
        throw queryError(`Relation target is not filterable: ${relation.one_collection}`, `${path}.${key}`);
      }
      const relatedScope = typeof limits.resolveRelatedScope === 'function'
        ? limits.resolveRelatedScope(relation, `${path}.${key}`, baseTargetSchema)
        : null;
      const targetSchema = relatedScope?.schema ?? baseTargetSchema;
      const targetPermissionFilter = relatedScope?.permissionFilter ?? null;

      const aliasSql = quoteIdentifier(`__yrel_${++state.aliasCounter}`, 'relation filter alias');
      const outerFieldSql = qualifier
        ? `${qualifier}.${quoteIdentifier(key, 'field name')}`
        : `${quoteIdentifier(schema.collection, 'collection name')}.${quoteIdentifier(key, 'field name')}`;
      const targetKey = relation.one_field || baseTargetSchema.primary_key || 'id';
      const targetKeySql = `${aliasSql}.${quoteIdentifier(targetKey, 'field name')}`;
      const targetTableSql = quoteIdentifier(relation.one_collection, 'collection name');
      const targetFromSql = state.rootCollection && relation.one_collection === state.rootCollection
        ? `(SELECT * FROM ${targetTableSql} LIMIT 18446744073709551615) AS ${aliasSql}`
        : `${targetTableSql} AS ${aliasSql}`;

      const innerClauses = [`${targetKeySql} = ${outerFieldSql}`];
      if (targetPermissionFilter) {
        const resolvedPermissionFilter = resolveDynamicVariables(
          targetPermissionFilter,
          limits.dynamicVariables ?? {},
          {
            allowUnresolved: limits.allowUnresolvedDynamicVariables,
            path: `${path}.${key}`,
          },
        );
        const permissionLimits = {
          ...limits,
          resolveRelatedScope: null,
          maxFilterNodes: limits.maxFilterNodes + QUERY_LIMITS.maxFilterNodes,
        };
        const compiledPermission = compileFilterObject(
          resolvedPermissionFilter,
          baseTargetSchema,
          `${path}.${key}`,
          permissionLimits,
          state,
          1,
          nextRelationDepth,
          aliasSql,
          snapshot,
        );
        innerClauses.push(`(${compiledPermission.sql})`);
        params.push(...compiledPermission.params);
      }

      const compiledRelated = compileFilterObject(
        Object.fromEntries(relationalEntries),
        targetSchema,
        `${path}.${key}`,
        limits,
        state,
        depth + 1,
        nextRelationDepth,
        aliasSql,
        snapshot,
      );
      innerClauses.push(`(${compiledRelated.sql})`);
      params.push(...compiledRelated.params);
      fieldFragments.push(`EXISTS (SELECT 1 FROM ${targetFromSql} WHERE ${innerClauses.join(' AND ')})`);
    }

    fragments.push(`(${fieldFragments.join(' AND ')})`);
  }
  if (fragments.length === 0) throw queryError('Filter cannot be empty', path);
  return { sql: fragments.join(' AND '), params };
}

export function compileFilter(filter, schema, options = {}) {
  if (!filter) return { sql: '', params: [] };
  const {
    dynamicVariables = {},
    allowUnresolvedDynamicVariables = false,
    allowRelational = true,
    schemaSnapshot = null,
    resolveRelatedScope = null,
    ...limitOptions
  } = options;
  const snapshot = schemaSnapshot ?? schema?.[SCHEMA_SNAPSHOT] ?? null;
  const limits = {
    ...QUERY_LIMITS,
    ...limitOptions,
    dynamicVariables,
    allowUnresolvedDynamicVariables,
    allowRelational,
    resolveRelatedScope,
  };
  assertFilterBudget(filter, limits);
  const resolvedFilter = resolveDynamicVariables(filter, dynamicVariables, {
    allowUnresolved: allowUnresolvedDynamicVariables,
    path: 'filter',
  });
  const state = {
    nodes: 0,
    aliasCounter: 0,
    rootCollection: schema?.collection ?? null,
  };
  const compiled = compileFilterObject(resolvedFilter, schema, 'filter', limits, state, 1, 0, null, snapshot);
  return { sql: ` WHERE ${compiled.sql}`, params: compiled.params };
}
