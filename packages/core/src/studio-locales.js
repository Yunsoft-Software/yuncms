export const STUDIO_LOCALE_CODES = Object.freeze(['en', 'tr', 'es', 'de', 'fr']);

const STUDIO_LOCALE_LOOKUP = new Map(
  STUDIO_LOCALE_CODES.map((locale) => [locale.toLowerCase(), locale]),
);

export function canonicalStudioLocale(value) {
  return STUDIO_LOCALE_LOOKUP.get(String(value ?? '').trim().toLowerCase()) ?? null;
}
