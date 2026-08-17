export const FIELD_TYPE_GROUPS = Object.freeze([
  Object.freeze({
    key: 'common',
    labelKey: 'fieldBuilder.commonTypes',
    options: Object.freeze([
      { value: 'string', labelKey: 'fieldType.string', descriptionKey: 'fieldBuilder.stringDescription', icon: 'Aa' },
      { value: 'text', labelKey: 'fieldType.text', descriptionKey: 'fieldBuilder.textDescription', icon: '¶' },
      { value: 'integer', labelKey: 'fieldType.integer', descriptionKey: 'fieldBuilder.integerDescription', icon: '123' },
      { value: 'decimal', labelKey: 'fieldType.decimal', descriptionKey: 'fieldBuilder.decimalDescription', icon: '1.2' },
      { value: 'boolean', labelKey: 'fieldType.boolean', descriptionKey: 'fieldBuilder.booleanDescription', icon: '✓' },
      { value: 'date', labelKey: 'fieldType.date', descriptionKey: 'fieldBuilder.dateDescription', icon: 'D' },
      { value: 'datetime', labelKey: 'fieldType.datetime', descriptionKey: 'fieldBuilder.datetimeDescription', icon: 'DT' },
      { value: 'timestamp', labelKey: 'fieldType.timestamp', descriptionKey: 'fieldBuilder.timestampDescription', icon: 'TS' },
    ]),
  }),
  Object.freeze({
    key: 'media',
    labelKey: 'fieldBuilder.mediaTypes',
    options: Object.freeze([
      { value: 'image', labelKey: 'fieldType.image', descriptionKey: 'fieldBuilder.imageDescription', icon: '▧' },
      { value: 'file', labelKey: 'fieldType.file', descriptionKey: 'fieldBuilder.fileDescription', icon: '⌑' },
    ]),
  }),
  Object.freeze({
    key: 'advanced',
    labelKey: 'fieldBuilder.advancedTypes',
    options: Object.freeze([
      { value: 'bigint', labelKey: 'fieldType.bigint', descriptionKey: 'fieldBuilder.bigintDescription', icon: '∞' },
      { value: 'json', labelKey: 'fieldType.json', descriptionKey: 'fieldBuilder.jsonDescription', icon: '{}' },
      { value: 'uuid', labelKey: 'fieldType.uuid', descriptionKey: 'fieldBuilder.uuidDescription', icon: 'ID' },
    ]),
  }),
]);

export const FIELD_TYPE_OPTIONS = Object.freeze(
  FIELD_TYPE_GROUPS.flatMap((group) => group.options),
);

const VALUE_DEFAULT_TYPES = new Set(['string', 'integer', 'bigint', 'decimal', 'boolean', 'date', 'datetime', 'timestamp', 'uuid']);
const CURRENT_TIME_TYPES = new Set(['datetime', 'timestamp']);

export function isFileField(field) {
  return field?.interface === 'file' || field?.interface === 'image';
}

export function isImageField(field) {
  return field?.interface === 'image';
}

export function isUserField(field) {
  return field?.interface === 'user';
}

export function fieldDisplayType(field) {
  if (field?.interface === 'image') return 'image';
  if (field?.interface === 'file') return 'file';
  if (field?.interface === 'user') return 'user';
  return field?.type || 'unknown';
}

export function supportsValueDefault(type) {
  return VALUE_DEFAULT_TYPES.has(type) && type !== 'image' && type !== 'file';
}

export function supportsCurrentTimeDefault(type) {
  return CURRENT_TIME_TYPES.has(type);
}

export function supportsAutoUpdate(type) {
  return CURRENT_TIME_TYPES.has(type);
}

function normalizeDateTimeDefault(value) {
  const normalized = String(value ?? '').trim().replace('T', ' ');
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(normalized)) return `${normalized}:00`;
  return normalized;
}

function normalizeDefaultValue(type, value) {
  if (type === 'boolean') return value === true || value === 'true';
  if (type === 'integer') return Number.parseInt(value, 10);
  if (type === 'bigint') return String(value);
  if (type === 'decimal') return Number(value);
  if (type === 'datetime' || type === 'timestamp') return normalizeDateTimeDefault(value);
  return value;
}

export function fieldCreationPayload(form = {}) {
  const specialInterface = form.type === 'file' || form.type === 'image' ? form.type : null;
  const storageType = specialInterface ? 'uuid' : form.type;
  const payload = {
    name: String(form.name || form.field || '').trim(),
    field: String(form.field || '').trim(),
    type: storageType,
    required: form.required === true,
  };

  if (storageType === 'string') payload.length = Number(form.length || 255);
  if (storageType === 'decimal') {
    payload.precision = Number(form.precision || 18);
    payload.scale = Number(form.scale ?? 2);
  }
  if (specialInterface) {
    payload.interface = specialInterface;
    payload.options = specialInterface === 'image' ? { accept: 'image/*', preview: true } : { preview: true };
  }

  if (!specialInterface && form.defaultMode === 'now' && supportsCurrentTimeDefault(storageType)) {
    payload.defaultPreset = 'now';
  } else if (!specialInterface && form.defaultMode === 'value' && supportsValueDefault(storageType)) {
    payload.defaultValue = normalizeDefaultValue(storageType, form.defaultValue);
  }

  if (!specialInterface && supportsAutoUpdate(storageType) && form.autoUpdate === true) {
    payload.autoUpdate = true;
  }
  return payload;
}

export function createEmptyFieldForm() {
  return {
    name: '',
    field: '',
    keyTouched: false,
    type: 'string',
    required: false,
    length: 255,
    precision: 18,
    scale: 2,
    defaultMode: 'none',
    defaultValue: '',
    autoUpdate: false,
  };
}

export function fileAcceptForField(field) {
  return isImageField(field) ? 'image/*' : undefined;
}
