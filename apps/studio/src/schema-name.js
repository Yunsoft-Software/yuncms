const TURKISH_ASCII = Object.freeze({
  ç: 'c', Ç: 'c', ğ: 'g', Ğ: 'g', ı: 'i', İ: 'i', ö: 'o', Ö: 'o', ş: 's', Ş: 's', ü: 'u', Ü: 'u',
});

export function schemaKeyFromName(value, prefix = 'field') {
  const source = String(value ?? '').trim();
  if (!source) return '';
  const transliterated = [...source].map((character) => TURKISH_ASCII[character] ?? character).join('');
  let key = transliterated
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .replace(/_+/g, '_');
  if (!key) return '';
  if (/^[0-9]/.test(key)) key = `${prefix}_${key}`;
  return key.slice(0, 64).replace(/_+$/g, '');
}

export function displaySchemaName(entry, keyName) {
  return entry?.name || entry?.[keyName] || '';
}
