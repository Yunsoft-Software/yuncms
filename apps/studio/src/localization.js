import { SUPPORTED_LOCALES } from './locale-registry.js';
import { AI_DE } from './locales/ai-de.js';
import { AI_EN } from './locales/ai-en.js';
import { AI_ES } from './locales/ai-es.js';
import { AI_FR } from './locales/ai-fr.js';
import { AI_JA } from './locales/ai-ja.js';
import { AI_PT_BR } from './locales/ai-pt-br.js';
import { AI_TR } from './locales/ai-tr.js';
import { AI_ZH_CN } from './locales/ai-zh-cn.js';
import { DE as BASE_DE } from './locales/de.js';
import { EN as BASE_EN } from './locales/en.js';
import { ES as BASE_ES } from './locales/es.js';
import { FR as BASE_FR } from './locales/fr.js';
import { JA as BASE_JA } from './locales/ja.js';
import { PT_BR as BASE_PT_BR } from './locales/pt-br.js';
import { TR as BASE_TR } from './locales/tr.js';
import { ZH_CN as BASE_ZH_CN } from './locales/zh-cn.js';
import { ICONS_DE } from './locales/icons-de.js';
import { ICONS_EN } from './locales/icons-en.js';
import { ICONS_ES } from './locales/icons-es.js';
import { ICONS_FR } from './locales/icons-fr.js';
import { ICONS_JA } from './locales/icons-ja.js';
import { ICONS_PT_BR } from './locales/icons-pt-br.js';
import { ICONS_TR } from './locales/icons-tr.js';
import { ICONS_ZH_CN } from './locales/icons-zh-cn.js';
import { NAVIGATION_DE } from './locales/navigation-de.js';
import { NAVIGATION_EN } from './locales/navigation-en.js';
import { NAVIGATION_ES } from './locales/navigation-es.js';
import { NAVIGATION_FR } from './locales/navigation-fr.js';
import { NAVIGATION_JA } from './locales/navigation-ja.js';
import { NAVIGATION_PT_BR } from './locales/navigation-pt-br.js';
import { NAVIGATION_TR } from './locales/navigation-tr.js';
import { NAVIGATION_ZH_CN } from './locales/navigation-zh-cn.js';
import { MCP_DE } from './locales/mcp-de.js';
import { MCP_EN } from './locales/mcp-en.js';
import { MCP_ES } from './locales/mcp-es.js';
import { MCP_FR } from './locales/mcp-fr.js';
import { MCP_JA } from './locales/mcp-ja.js';
import { MCP_PT_BR } from './locales/mcp-pt-br.js';
import { MCP_TR } from './locales/mcp-tr.js';
import { MCP_ZH_CN } from './locales/mcp-zh-cn.js';
import { REGISTRATION_DE } from './locales/registration-de.js';
import { REGISTRATION_EN } from './locales/registration-en.js';
import { REGISTRATION_ES } from './locales/registration-es.js';
import { REGISTRATION_FR } from './locales/registration-fr.js';
import { REGISTRATION_JA } from './locales/registration-ja.js';
import { REGISTRATION_PT_BR } from './locales/registration-pt-br.js';
import { REGISTRATION_TR } from './locales/registration-tr.js';
import { REGISTRATION_ZH_CN } from './locales/registration-zh-cn.js';
import { STUDIO_NEXT_DE } from './locales/studio-next-de.js';
import { STUDIO_NEXT_EN } from './locales/studio-next-en.js';
import { STUDIO_NEXT_ES } from './locales/studio-next-es.js';
import { STUDIO_NEXT_FR } from './locales/studio-next-fr.js';
import { STUDIO_NEXT_JA } from './locales/studio-next-ja.js';
import { STUDIO_NEXT_PT_BR } from './locales/studio-next-pt-br.js';
import { STUDIO_NEXT_TR } from './locales/studio-next-tr.js';
import { STUDIO_NEXT_ZH_CN } from './locales/studio-next-zh-cn.js';
import { UI_DE } from './locales/ui-de.js';
import { UI_EN } from './locales/ui-en.js';
import { UI_ES } from './locales/ui-es.js';
import { UI_FR } from './locales/ui-fr.js';
import { UI_JA } from './locales/ui-ja.js';
import { UI_PT_BR } from './locales/ui-pt-br.js';
import { UI_TR } from './locales/ui-tr.js';
import { UI_ZH_CN } from './locales/ui-zh-cn.js';
import { UX_DE } from './locales/ux-de.js';
import { UX_EN } from './locales/ux-en.js';
import { UX_ES } from './locales/ux-es.js';
import { UX_FR } from './locales/ux-fr.js';
import { UX_JA } from './locales/ux-ja.js';
import { UX_PT_BR } from './locales/ux-pt-br.js';
import { UX_TR } from './locales/ux-tr.js';
import { UX_ZH_CN } from './locales/ux-zh-cn.js';

export const EN = Object.freeze({ ...BASE_EN, ...UI_EN, ...UX_EN, ...ICONS_EN, ...AI_EN, ...MCP_EN, ...NAVIGATION_EN, ...REGISTRATION_EN, ...STUDIO_NEXT_EN });
export const TR = Object.freeze({ ...BASE_TR, ...UI_TR, ...UX_TR, ...ICONS_TR, ...AI_TR, ...MCP_TR, ...NAVIGATION_TR, ...REGISTRATION_TR, ...STUDIO_NEXT_TR });
export const ES = Object.freeze({ ...BASE_ES, ...UI_ES, ...UX_ES, ...ICONS_ES, ...AI_ES, ...MCP_ES, ...NAVIGATION_ES, ...REGISTRATION_ES, ...STUDIO_NEXT_ES });
export const DE = Object.freeze({ ...BASE_DE, ...UI_DE, ...UX_DE, ...ICONS_DE, ...AI_DE, ...MCP_DE, ...NAVIGATION_DE, ...REGISTRATION_DE, ...STUDIO_NEXT_DE });
export const FR = Object.freeze({ ...BASE_FR, ...UI_FR, ...UX_FR, ...ICONS_FR, ...AI_FR, ...MCP_FR, ...NAVIGATION_FR, ...REGISTRATION_FR, ...STUDIO_NEXT_FR });
export const PT_BR = Object.freeze({ ...BASE_PT_BR, ...UI_PT_BR, ...UX_PT_BR, ...ICONS_PT_BR, ...AI_PT_BR, ...MCP_PT_BR, ...NAVIGATION_PT_BR, ...REGISTRATION_PT_BR, ...STUDIO_NEXT_PT_BR });
export const JA = Object.freeze({ ...BASE_JA, ...UI_JA, ...UX_JA, ...ICONS_JA, ...AI_JA, ...MCP_JA, ...NAVIGATION_JA, ...REGISTRATION_JA, ...STUDIO_NEXT_JA });
export const ZH_CN = Object.freeze({ ...BASE_ZH_CN, ...UI_ZH_CN, ...UX_ZH_CN, ...ICONS_ZH_CN, ...AI_ZH_CN, ...MCP_ZH_CN, ...NAVIGATION_ZH_CN, ...REGISTRATION_ZH_CN, ...STUDIO_NEXT_ZH_CN });

export const DICTIONARIES = Object.freeze({
  en: EN,
  tr: TR,
  es: ES,
  de: DE,
  fr: FR,
  'pt-BR': PT_BR,
  ja: JA,
  'zh-CN': ZH_CN,
});

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
