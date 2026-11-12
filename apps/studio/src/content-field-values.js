import { isSelectDropdownField, selectChoicesForField } from './field-ui.js';

// One typed initialization contract for record and nested relation forms.
export function inputValueForField(field, value) {
  if (value === undefined) {
    let metadata = field?.schema_metadata ?? {};
    if (typeof metadata === 'string') {
      try { metadata = JSON.parse(metadata); } catch { metadata = {}; }
    }
    if (metadata && Object.hasOwn(metadata, 'defaultValue') && !metadata.defaultPreset) {
      const candidate = metadata.defaultValue;
      if (isSelectDropdownField(field)) {
        const choices = selectChoicesForField(field);
        if (
          candidate == null
          || candidate === ''
          || choices.length === 0
          || choices.some((choice) => String(choice.value) === String(candidate))
        ) {
          value = candidate;
        }
      } else {
        value = candidate;
      }
    }
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
  if (field?.type === 'bigint') return String(value);
  if (field?.type === 'integer') return Number.parseInt(value, 10);
  if (field?.type === 'decimal') return Number(value);
  if (field?.type === 'json') return value === '' ? null : typeof value === 'string' ? JSON.parse(value) : value;
  return value;
}
