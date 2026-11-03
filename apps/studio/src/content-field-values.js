// One typed initialization contract for record and nested relation forms.
export function inputValueForField(field, value) {
  if (value === undefined) {
    let metadata = field?.schema_metadata ?? {};
    if (typeof metadata === 'string') {
      try { metadata = JSON.parse(metadata); } catch { metadata = {}; }
    }
    if (metadata && Object.hasOwn(metadata, 'defaultValue') && !metadata.defaultPreset) value = metadata.defaultValue;
  }
  if (value == null) return field?.type === 'boolean' ? false : '';
  if (field?.type === 'json') return typeof value === 'string' ? value : JSON.stringify(value, null, 2);
  if (field?.type === 'boolean') return value === true || value === 1 || value === '1' || value === 'true';
  if (field?.type === 'datetime' || field?.type === 'timestamp') {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? String(value) : date.toISOString().slice(0, 16);
  }
  return String(value);
}

export function outputValueForField(field, value) {
  if (value === '' && !field?.required) return null;
  if (field?.type === 'boolean') return Boolean(value);
  if (field?.type === 'integer' || field?.type === 'bigint') return Number.parseInt(value, 10);
  if (field?.type === 'decimal') return Number(value);
  if (field?.type === 'json') return value === '' ? null : typeof value === 'string' ? JSON.parse(value) : value;
  return value;
}
