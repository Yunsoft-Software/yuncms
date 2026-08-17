export const FIELD_TYPE_OPTIONS = Object.freeze([
  { value: 'string', labelKey: 'fieldType.string' },
  { value: 'text', labelKey: 'fieldType.text' },
  { value: 'integer', labelKey: 'fieldType.integer' },
  { value: 'bigint', labelKey: 'fieldType.bigint' },
  { value: 'decimal', labelKey: 'fieldType.decimal' },
  { value: 'boolean', labelKey: 'fieldType.boolean' },
  { value: 'date', labelKey: 'fieldType.date' },
  { value: 'datetime', labelKey: 'fieldType.datetime' },
  { value: 'timestamp', labelKey: 'fieldType.timestamp' },
  { value: 'json', labelKey: 'fieldType.json' },
  { value: 'uuid', labelKey: 'fieldType.uuid' },
  { value: 'file', labelKey: 'fieldType.file' },
  { value: 'image', labelKey: 'fieldType.image' },
]);

export function isFileField(field) {
  return field?.interface === 'file' || field?.interface === 'image';
}

export function isImageField(field) {
  return field?.interface === 'image';
}

export function fieldDisplayType(field) {
  if (field?.interface === 'image') return 'image';
  if (field?.interface === 'file') return 'file';
  return field?.type || 'unknown';
}

export function fieldCreationPayload(form = {}) {
  const specialInterface = form.type === 'file' || form.type === 'image' ? form.type : null;
  const payload = {
    field: String(form.field || '').trim(),
    type: specialInterface ? 'uuid' : form.type,
    required: form.required === true,
  };
  if (payload.type === 'string') payload.length = Number(form.length || 255);
  if (specialInterface) {
    payload.interface = specialInterface;
    payload.options = specialInterface === 'image' ? { accept: 'image/*', preview: true } : { preview: true };
  }
  return payload;
}

export function fileAcceptForField(field) {
  return isImageField(field) ? 'image/*' : undefined;
}
