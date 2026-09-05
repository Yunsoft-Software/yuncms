import { SUPPORTED_LOCALES } from './locale-registry.js';
import { AI_DE } from './locales/ai-de.js';
import { AI_EN } from './locales/ai-en.js';
import { AI_ES } from './locales/ai-es.js';
import { AI_FR } from './locales/ai-fr.js';
import { AI_TR } from './locales/ai-tr.js';
import { DE as BASE_DE } from './locales/de.js';
import { EN as BASE_EN } from './locales/en.js';
import { ES as BASE_ES } from './locales/es.js';
import { FR as BASE_FR } from './locales/fr.js';
import { TR as BASE_TR } from './locales/tr.js';
import { NAVIGATION_DE } from './locales/navigation-de.js';
import { NAVIGATION_EN } from './locales/navigation-en.js';
import { NAVIGATION_ES } from './locales/navigation-es.js';
import { NAVIGATION_FR } from './locales/navigation-fr.js';
import { NAVIGATION_TR } from './locales/navigation-tr.js';
import { MCP_DE } from './locales/mcp-de.js';
import { MCP_EN } from './locales/mcp-en.js';
import { MCP_ES } from './locales/mcp-es.js';
import { MCP_FR } from './locales/mcp-fr.js';
import { MCP_TR } from './locales/mcp-tr.js';
import { REGISTRATION_DE } from './locales/registration-de.js';
import { REGISTRATION_EN } from './locales/registration-en.js';
import { REGISTRATION_ES } from './locales/registration-es.js';
import { REGISTRATION_FR } from './locales/registration-fr.js';
import { REGISTRATION_TR } from './locales/registration-tr.js';
import { STUDIO_NEXT_DE } from './locales/studio-next-de.js';
import { STUDIO_NEXT_EN } from './locales/studio-next-en.js';
import { STUDIO_NEXT_ES } from './locales/studio-next-es.js';
import { STUDIO_NEXT_FR } from './locales/studio-next-fr.js';
import { STUDIO_NEXT_TR } from './locales/studio-next-tr.js';
import { UI_DE } from './locales/ui-de.js';
import { UI_EN } from './locales/ui-en.js';
import { UI_ES } from './locales/ui-es.js';
import { UI_FR } from './locales/ui-fr.js';
import { UI_TR } from './locales/ui-tr.js';
import { UX_DE } from './locales/ux-de.js';
import { UX_EN } from './locales/ux-en.js';
import { UX_ES } from './locales/ux-es.js';
import { UX_FR } from './locales/ux-fr.js';
import { UX_TR } from './locales/ux-tr.js';

export const EN = Object.freeze({ ...BASE_EN, ...UI_EN, ...UX_EN, ...AI_EN, ...MCP_EN, ...NAVIGATION_EN, ...REGISTRATION_EN, ...STUDIO_NEXT_EN });
export const TR = Object.freeze({ ...BASE_TR, ...UI_TR, ...UX_TR, ...AI_TR, ...MCP_TR, ...NAVIGATION_TR, ...REGISTRATION_TR, ...STUDIO_NEXT_TR });
export const ES = Object.freeze({ ...BASE_ES, ...UI_ES, ...UX_ES, ...AI_ES, ...MCP_ES, ...NAVIGATION_ES, ...REGISTRATION_ES, ...STUDIO_NEXT_ES });
export const DE = Object.freeze({ ...BASE_DE, ...UI_DE, ...UX_DE, ...AI_DE, ...MCP_DE, ...NAVIGATION_DE, ...REGISTRATION_DE, ...STUDIO_NEXT_DE });
export const FR = Object.freeze({ ...BASE_FR, ...UI_FR, ...UX_FR, ...AI_FR, ...MCP_FR, ...NAVIGATION_FR, ...REGISTRATION_FR, ...STUDIO_NEXT_FR });

export const DICTIONARIES = Object.freeze({ en: EN, tr: TR, es: ES, de: DE, fr: FR });

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

export { SUPPORTED_LOCALES };
