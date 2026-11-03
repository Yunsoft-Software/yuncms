export const RELATION_PREVIEW_LIMIT = 2;

export function relationPreview(rows = [], limit = RELATION_PREVIEW_LIMIT) {
  const visible = rows.slice(0, limit);
  return { visible, remaining: Math.max(0, rows.length - visible.length) };
}

export function contentColumnKind(field = {}) {
  if (field.virtualRelation) return 'relation';
  if (field.field === 'id' || field.type === 'uuid') return 'identity';
  if (['boolean', 'integer', 'bigint', 'decimal'].includes(field.type)) return 'scalar';
  if (['date', 'datetime', 'timestamp'].includes(field.type)) return 'date';
  if (['image', 'file'].includes(field.interface)) return 'file';
  if (field.field === 'status' || field.field?.endsWith('_status')) return 'status';
  return 'text';
}
