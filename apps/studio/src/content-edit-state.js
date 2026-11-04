// Edit metadata is deliberately kept outside JSON record payloads.
export const ITEM_REVISION = Symbol('yuncms.itemRevision');
export const EDIT_PREFERENCE = { prefer: 'yuncms-edit-state' };
export function withEditState(result) {
  if (!result?.data) return result;
  const attach = (row, revision) => {
    if (row && typeof row === 'object' && revision != null) row[ITEM_REVISION] = String(revision);
    return row;
  };
  if (Array.isArray(result.data)) {
    for (const row of result.data) attach(row, result.meta?.revisions?.[String(row[result.meta?.primaryKey ?? 'id'])]);
  } else attach(result.data, result.meta?.revision);
  return result;
}
export function editHeaders(record) {
  return { ...EDIT_PREFERENCE, ...(record?.[ITEM_REVISION] == null ? {} : { 'x-yuncms-item-revision': record[ITEM_REVISION] }) };
}
export function editRequest(request) {
  return async (path, options = {}) => withEditState(await request(path, { ...options, headers: { ...EDIT_PREFERENCE, ...options.headers } }));
}

export function contentDraftKey(values, nestedDraft = {}) {
  const canonical = value => {
    if (Array.isArray(value)) {
      const items = value.map(canonical);
      return items.every(item => typeof item === 'string') ? items.sort() : items;
    }
    if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]));
    return value;
  };
  const nested = Object.fromEntries(Object.entries(nestedDraft).map(([key, rows]) => [key, Array.isArray(rows)
    ? rows.filter(row => !row || typeof row !== 'object' || row.id != null || !row.deleted).map(row => {
      if (!row || typeof row !== 'object') return row;
      const { _localId, ...entry } = row; return entry;
    }) : rows]));
  return JSON.stringify(canonical({ values, nested }));
}
