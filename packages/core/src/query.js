import { quoteIdentifier } from './identifier.js';

const QUERY_KEYS = new Set(['fields', 'filter', 'sort', 'limit', 'offset']);
const FILTER_OPERATORS = new Set([
  '_eq', '_neq', '_lt', '_lte', '_gt', '_gte',
  '_in', '_nin', '_null', '_nnull',
  '_contains', '_starts_with', '_ends_with',
]);

function queryError(message, path = null) {
  const error = new Error(message);
  error.code = 'INVALID_QUERY';
  if (path) error.path = path;
  return error;
}

function normalizeDelimited(value, label) {
  if (value == null || value === '') return null;
  const values = Array.isArray(value) ? value : String(value).split(',');
  const normalized = values.map((item) => String(item).trim()).filter(Boolean);
  if (normalized.length === 0) throw queryError(`${label} cannot be empty`, label);
  return normalized;
}

function normalizeInteger(value, fallback, { label, min, max }) {
  if (value == null || value === '') return fallback;
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
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new Error('not an object');
      }
      return parsed;
    } catch {
      throw queryError('filter must be a valid JSON object', 'filter');
    }
  }
  if (typeof value !== 'object' || Array.isArray(value)) {
    throw queryError('filter must be an object', 'filter');
  }
  return value;
}

export function parseItemsQuery(raw = {}, { defaultLimit = 100, maxLimit = 500 } = {}) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw queryError('Query must be an object');
  }

  for (const key of Object.keys(raw)) {
    if (!QUERY_KEYS.has(key)) throw queryError(`Unknown query parameter: ${key}`, key);
  }

  return {
    fields: normalizeDelimited(raw.fields, 'fields'),
    filter: normalizeFilter(raw.filter),
    sort: normalizeDelimited(raw.sort, 'sort'),
    limit: normalizeInteger(raw.limit, defaultLimit, { label: 'limit', min: 1, max: maxLimit }),
    offset: normalizeInteger(raw.offset, 0, { label: 'offset', min: 0, max: Number.MAX_SAFE_INTEGER }),
  };
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

function compileOperator(fieldSql, operator, value, path) {
  if (!FILTER_OPERATORS.has(operator)) throw queryError(`Unknown filter operator: ${operator}`, path);

  switch (operator) {
    case '_eq':
      if (value === null) throw queryError('Use _null for NULL comparisons', path);
      return { sql: `${fieldSql} = ?`, params: [value] };
    case '_neq':
      if (value === null) throw queryError('Use _nnull for NULL comparisons', path);
      return { sql: `${fieldSql} <> ?`, params: [value] };
    case '_lt': return { sql: `${fieldSql} < ?`, params: [value] };
    case '_lte': return { sql: `${fieldSql} <= ?`, params: [value] };
    case '_gt': return { sql: `${fieldSql} > ?`, params: [value] };
    case '_gte': return { sql: `${fieldSql} >= ?`, params: [value] };
    case '_in':
    case '_nin': {
      if (!Array.isArray(value)) throw queryError(`${operator} requires an array`, path);
      if (value.length === 0) return { sql: operator === '_in' ? '0 = 1' : '1 = 1', params: [] };
      const placeholders = value.map(() => '?').join(', ');
      return {
        sql: `${fieldSql} ${operator === '_in' ? 'IN' : 'NOT IN'} (${placeholders})`,
        params: value,
      };
    }
    case '_null':
    case '_nnull': {
      if (typeof value !== 'boolean') throw queryError(`${operator} requires a boolean`, path);
      const wantsNull = operator === '_null' ? value : !value;
      return { sql: `${fieldSql} IS ${wantsNull ? '' : 'NOT '}NULL`, params: [] };
    }
    case '_contains':
      return { sql: `${fieldSql} LIKE ? ESCAPE '\\\\'`, params: [`%${escapeLike(value)}%`] };
    case '_starts_with':
      return { sql: `${fieldSql} LIKE ? ESCAPE '\\\\'`, params: [`${escapeLike(value)}%`] };
    case '_ends_with':
      return { sql: `${fieldSql} LIKE ? ESCAPE '\\\\'`, params: [`%${escapeLike(value)}`] };
    default:
      throw queryError(`Unknown filter operator: ${operator}`, path);
  }
}

function compileFilterObject(filter, schema, path = 'filter') {
  if (!filter || typeof filter !== 'object' || Array.isArray(filter)) {
    throw queryError('Filter node must be an object', path);
  }

  const fragments = [];
  const params = [];

  for (const [key, value] of Object.entries(filter)) {
    if (key === '_and' || key === '_or') {
      if (!Array.isArray(value) || value.length === 0) {
        throw queryError(`${key} requires a non-empty array`, `${path}.${key}`);
      }
      const children = value.map((child, index) =>
        compileFilterObject(child, schema, `${path}.${key}.${index}`));
      fragments.push(`(${children.map((child) => child.sql).join(key === '_and' ? ' AND ' : ' OR ')})`);
      for (const child of children) params.push(...child.params);
      continue;
    }

    resolveField(schema, key, `${path}.${key}`);
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw queryError('Field filters must be operator objects', `${path}.${key}`);
    }

    const fieldSql = quoteIdentifier(key, 'field name');
    const fieldFragments = [];
    for (const [operator, operatorValue] of Object.entries(value)) {
      const compiled = compileOperator(fieldSql, operator, operatorValue, `${path}.${key}.${operator}`);
      fieldFragments.push(compiled.sql);
      params.push(...compiled.params);
    }
    if (fieldFragments.length === 0) throw queryError('Field filter cannot be empty', `${path}.${key}`);
    fragments.push(`(${fieldFragments.join(' AND ')})`);
  }

  if (fragments.length === 0) throw queryError('Filter cannot be empty', path);
  return { sql: fragments.join(' AND '), params };
}

export function compileFilter(filter, schema) {
  if (!filter) return { sql: '', params: [] };
  const compiled = compileFilterObject(filter, schema);
  return { sql: ` WHERE ${compiled.sql}`, params: compiled.params };
}
