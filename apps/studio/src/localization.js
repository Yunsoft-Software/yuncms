import { EN } from './locales/en.js';
import { TR } from './locales/tr.js';

const DICTIONARIES = Object.freeze({ en: EN, tr: TR });

function interpolate(message, values = {}) {
  return message.replace(/\{(\w+)\}/g, (_, key) => (
    Object.hasOwn(values, key) ? String(values[key]) : `{${key}}`
  ));
}

export function hasTranslation(locale, key) {
  return Object.hasOwn(DICTIONARIES[locale] ?? {}, key);
}

export function translate(locale, key, values = {}) {
  const dictionary = DICTIONARIES[locale] ?? EN;
  const message = dictionary[key] ?? EN[key] ?? key;
  return interpolate(message, values);
}

export const SUPPORTED_LOCALES = Object.freeze(['en', 'tr']);
export { EN, TR };
