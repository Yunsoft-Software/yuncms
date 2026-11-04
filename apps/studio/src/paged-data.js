export class StudioPaginationError extends Error {
  constructor() { super('Related records changed while loading. Reload the record.'); this.code = 'STUDIO_PAGINATION_CHANGED'; }
}

export function studioPagePath(path, { offset = 0, limit = 200 } = {}) {
  const separator = path.indexOf('?');
  const resource = separator < 0 ? path : path.slice(0, separator);
  const query = new URLSearchParams(separator < 0 ? '' : path.slice(separator + 1));
  query.set('limit', String(limit));
  if (offset) query.set('offset', String(offset));
  else query.delete('offset');
  return `${resource}?${query}`;
}

// Native list endpoints return either an array or an array with pagination meta.
// Keep reading the same filtered resource until every page is accounted for.
export async function readAllStudioPages(path, { request, limit = 200, keyField = 'id' } = {}) {
  if (typeof request !== 'function') throw new TypeError('A native API request function is required');
  const rows = [], seen = new Set();
  let offset = 0, expectedTotal;
  while (true) {
    const result = await request(studioPagePath(path, { offset, limit }));
    if (!Array.isArray(result?.data)) throw new TypeError('Expected a native list response');
    const batch = result.data;
    const total = result.meta?.total_count;
    if (Number.isSafeInteger(total)) {
      if (expectedTotal !== undefined && total !== expectedTotal) throw new StudioPaginationError();
      expectedTotal = total;
    }
    if (batch.length === 0) {
      if (Number.isSafeInteger(total) && offset < total) throw new StudioPaginationError();
      return rows;
    }
    for (const row of batch) {
      const key = row?.[keyField];
      if (key !== undefined && key !== null) {
        const identity = `${typeof key}:${key}`;
        if (seen.has(identity)) throw new StudioPaginationError();
        seen.add(identity);
      }
      rows.push(row);
    }
    offset += batch.length;
    if (Number.isSafeInteger(total)) {
      if (offset >= total) return rows;
    } else if (batch.length < (result.meta?.limit ?? limit)) return rows;
  }
}
