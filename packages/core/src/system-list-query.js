import { assertIdentifier } from './identifier.js';
import { compileSearch, parseItemsQuery, QUERY_LIMITS } from './query.js';

export const SYSTEM_LIST_LIMITS = Object.freeze({
  defaultLimit: QUERY_LIMITS.defaultLimit,
  minLimit: 1,
  maxLimit: QUERY_LIMITS.maxLimit,
  defaultOffset: 0,
  minOffset: 0,
  maxOffset: QUERY_LIMITS.maxOffset,
  maxSearchLength: QUERY_LIMITS.maxSearchLength,
});

const ALLOWED_QUERY_KEYS = new Set(['limit', 'offset', 'search']);

export const USER_SAFE_SELECT_COLUMNS = Object.freeze([
  'id',
  'email',
  'role',
  'status',
  'email_verified_at',
  'last_access',
  'created_at',
  'updated_at',
]);

export const ROLE_SAFE_SELECT_COLUMNS = Object.freeze([
  'id',
  'name',
  'description',
  'admin',
  'public',
  'created_at',
  'updated_at',
]);

export const USER_SYSTEM_SEARCH_SCHEMA = Object.freeze({
  fields: {
    email: { field: 'email', type: 'string' },
  },
});

export const ROLE_SYSTEM_SEARCH_SCHEMA = Object.freeze({
  fields: {
    name: { field: 'name', type: 'string' },
    description: { field: 'description', type: 'string' },
  },
});

function queryError(message, path = null) {
  const error = new Error(message);
  error.code = 'INVALID_QUERY';
  if (path) error.path = path;
  return error;
}

export function parseSystemListQuery(raw = {}) {
  if (raw == null) {
    return Object.freeze({
      isBounded: false,
      limit: null,
      offset: null,
      search: null,
    });
  }

  if (typeof raw !== 'object' || Array.isArray(raw)) {
    throw queryError('Query must be an object');
  }

  const keys = Object.keys(raw);
  if (keys.length === 0) {
    return Object.freeze({
      isBounded: false,
      limit: null,
      offset: null,
      search: null,
    });
  }

  for (const key of keys) {
    if (!ALLOWED_QUERY_KEYS.has(key)) {
      throw queryError(`Unknown query parameter: ${key}`, key);
    }
  }

  if (raw.search !== undefined && raw.search !== null && raw.search !== '') {
    if (typeof raw.search !== 'string') {
      throw queryError('search must be a string', 'search');
    }
  }

  const parsed = parseItemsQuery(raw);

  return Object.freeze({
    isBounded: true,
    limit: parsed.limit,
    offset: parsed.offset,
    search: parsed.search,
  });
}

export function buildSystemListQuery(rawQuery, { table, columns, orderBy, searchSchema }) {
  const parsed = parseSystemListQuery(rawQuery);
  const validatedTable = assertIdentifier(table, 'table');
  const validatedColumns = columns.map((col) => assertIdentifier(col, 'column')).join(', ');

  if (!parsed.isBounded) {
    return {
      parsed,
      sql: `SELECT ${validatedColumns}\nFROM ${validatedTable}\nORDER BY ${orderBy}`,
      params: [],
    };
  }

  const searchResult = compileSearch(parsed.search, searchSchema);
  const whereSql = searchResult.sql ? `\n${searchResult.sql.trim()}` : '';

  return {
    parsed,
    sql: `SELECT ${validatedColumns}\nFROM ${validatedTable}${whereSql}\nORDER BY ${orderBy}\nLIMIT ? OFFSET ?`,
    params: [...searchResult.params, parsed.limit, parsed.offset],
  };
}
