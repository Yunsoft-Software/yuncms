import { AI_EN } from './locales/ai-en.js';
import { AI_TR } from './locales/ai-tr.js';
import { EN as BASE_EN } from './locales/en.js';
import { TR as BASE_TR } from './locales/tr.js';
import { UI_EN } from './locales/ui-en.js';
import { UI_TR } from './locales/ui-tr.js';
import { UX_EN } from './locales/ux-en.js';
import { UX_TR } from './locales/ux-tr.js';

export const EN = Object.freeze({ ...BASE_EN, ...UI_EN, ...UX_EN, ...AI_EN });
export const TR = Object.freeze({ ...BASE_TR, ...UI_TR, ...UX_TR, ...AI_TR });

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