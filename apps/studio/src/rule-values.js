export const DYNAMIC_VALUES = Object.freeze([
  '$CURRENT_USER', '$CURRENT_ROLE', '$NOW', '$NOW(-1 day)', '$NOW(+1 day)',
]);

export function normalizeRuleValue(type, operator, value) {
  if (operator === '_null' || operator === '_nnull') return true;
  if (typeof value === 'string' && DYNAMIC_VALUES.some(entry => value.startsWith(entry.replace(/\(.+$/, '')))) return value;
  if (type === 'boolean') return value === true || value === 'true';
  if (type === 'bigint') return String(value);
  if (type === 'integer') {
    const parsed = Number.parseInt(value, 10);
    return Number.isNaN(parsed) ? value : parsed;
  }
  if (type === 'decimal') {
    const parsed = Number(value);
    return Number.isNaN(parsed) ? value : parsed;
  }
  return value;
}
