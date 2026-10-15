import { flowError } from './definition.js';

function integer(value, fallback, min, max) {
  if (value === undefined) return fallback;
  if (!['string', 'number'].includes(typeof value) || !/^\d+$/.test(String(value))) throw flowError('INVALID_FLOW_QUERY', 'Use bounded non-negative integer pagination values');
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < min || number > max) throw flowError('INVALID_FLOW_QUERY', 'Pagination value is out of range');
  return number;
}
export function normalizeFlowPageQuery(input = {}, { runs = false } = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw flowError('INVALID_FLOW_QUERY', 'Provide a query object');
  const allowed = runs ? ['limit', 'offset', 'summary', 'meta'] : ['limit', 'offset', 'summary', 'meta', 'search', 'status', 'trigger'];
  if (Object.keys(input).some(key => !allowed.includes(key))) throw flowError('INVALID_FLOW_QUERY', 'Unsupported flow query option');
  const query = { limit: integer(input.limit, 10, 1, 100), offset: integer(input.offset, 0, 0, 2147483647) };
  if (input.summary !== undefined && ![true, false, '1', '0', 'true', 'false'].includes(input.summary)) throw flowError('INVALID_FLOW_QUERY', 'Invalid summary option');
  query.summary = [true, '1', 'true'].includes(input.summary);
  if (input.meta !== undefined && input.meta !== 'filter_count') throw flowError('INVALID_FLOW_QUERY', 'Only filter_count metadata is supported');
  if (!runs) {
    if (input.search !== undefined && (typeof input.search !== 'string' || input.search.length > 200)) throw flowError('INVALID_FLOW_QUERY', 'Search must be text up to 200 characters');
    query.search = (input.search ?? '').trim();
    for (const [key, allowed] of [['status', ['active', 'inactive']], ['trigger', ['manual', 'event', 'webhook', 'schedule', 'operation']]]) {
      if (input[key] !== undefined && !allowed.includes(input[key])) throw flowError('INVALID_FLOW_QUERY', `Invalid ${key} filter`);
      query[key] = input[key] ?? null;
    }
  }
  return query;
}
export function flowListPredicate(query) {
  const clauses = [], values = [];
  if (query.search) { clauses.push('LOCATE(?, name) > 0'); values.push(query.search); }
  if (query.status) { clauses.push('status = ?'); values.push(query.status); }
  if (query.trigger) { clauses.push('trigger_type = ?'); values.push(query.trigger); }
  return { sql: clauses.length ? ' WHERE ' + clauses.join(' AND ') : '', values };
}
