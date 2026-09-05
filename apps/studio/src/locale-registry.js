export const LOCALE_CATALOG = Object.freeze({
  en: Object.freeze({ code: 'en', name: 'English', nativeName: 'English', direction: 'ltr', enabled: true }),
  tr: Object.freeze({ code: 'tr', name: 'Turkish', nativeName: 'Türkçe', direction: 'ltr', enabled: true }),
  es: Object.freeze({ code: 'es', name: 'Spanish', nativeName: 'Español', direction: 'ltr', enabled: false }),
  de: Object.freeze({ code: 'de', name: 'German', nativeName: 'Deutsch', direction: 'ltr', enabled: false }),
  fr: Object.freeze({ code: 'fr', name: 'French', nativeName: 'Français', direction: 'ltr', enabled: false }),
  'pt-BR': Object.freeze({ code: 'pt-BR', name: 'Portuguese (Brazil)', nativeName: 'Português (Brasil)', direction: 'ltr', enabled: false }),
  ja: Object.freeze({ code: 'ja', name: 'Japanese', nativeName: '日本語', direction: 'ltr', enabled: false }),
  'zh-CN': Object.freeze({ code: 'zh-CN', name: 'Chinese (Simplified)', nativeName: '简体中文', direction: 'ltr', enabled: false }),
  it: Object.freeze({ code: 'it', name: 'Italian', nativeName: 'Italiano', direction: 'ltr', enabled: false }),
  ru: Object.freeze({ code: 'ru', name: 'Russian', nativeName: 'Русский', direction: 'ltr', enabled: false }),
  pl: Object.freeze({ code: 'pl', name: 'Polish', nativeName: 'Polski', direction: 'ltr', enabled: false }),
  ko: Object.freeze({ code: 'ko', name: 'Korean', nativeName: '한국어', direction: 'ltr', enabled: false }),
  id: Object.freeze({ code: 'id', name: 'Indonesian', nativeName: 'Bahasa Indonesia', direction: 'ltr', enabled: false }),
  ar: Object.freeze({ code: 'ar', name: 'Arabic', nativeName: 'العربية', direction: 'rtl', enabled: false }),
});

export const SUPPORTED_LOCALES = Object.freeze(
  Object.values(LOCALE_CATALOG)
    .filter((locale) => locale.enabled)
    .map((locale) => locale.code),
);

export function isSupportedLocale(locale) {
  return SUPPORTED_LOCALES.includes(locale);
}

export function getLocaleDefinition(locale) {
  return LOCALE_CATALOG[locale] ?? LOCALE_CATALOG.en;
}

export function getEnabledLocaleDefinitions() {
  return SUPPORTED_LOCALES.map((locale) => LOCALE_CATALOG[locale]);
}
