const TURKISH_ASCII = Object.freeze({
  ç: 'c',
  Ç: 'c',
  ğ: 'g',
  Ğ: 'g',
  ı: 'i',
  İ: 'i',
  ö: 'o',
  Ö: 'o',
  ş: 's',
  Ş: 's',
  ü: 'u',
  Ü: 'u',
});

function schemaNameError(message) {
  const error = new Error(message);
  error.code = 'INVALID_SCHEMA_NAME';
  return error;
}

export function normalizeDisplayName(value, { fallback = null, maxLength = 255 } = {}) {
  const candidate = typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : '';
  const normalized = candidate || (typeof fallback === 'string' ? fallback.trim().replace(/\s+/g, ' ') : '');
  if (!normalized) throw schemaNameError('A display name is required');
  if (normalized.length > maxLength) throw schemaNameError(`Display name cannot exceed ${maxLength} characters`);
  return normalized;
}

export function normalizeSchemaKey(value, { prefix = 'field', maxLength = 64 } = {}) {
  const source = normalizeDisplayName(value, { maxLength: 512 });
  const transliterated = [...source].map((character) => TURKISH_ASCII[character] ?? character).join('');
  let key = transliterated
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .replace(/_+/g, '_');

  if (!key) throw schemaNameError('Name must contain at least one letter or number');
  if (/^[0-9]/.test(key)) key = `${prefix}_${key}`;
  if (key.length > maxLength) key = key.slice(0, maxLength).replace(/_+$/g, '');
  if (!key) throw schemaNameError('Name cannot be normalized to a schema key');
  return key;
}

export function resolveSchemaName({ displayName, key, prefix = 'field' } = {}) {
  const name = normalizeDisplayName(displayName ?? key);
  return {
    name,
    key: normalizeSchemaKey(key ?? name, { prefix }),
  };
}
