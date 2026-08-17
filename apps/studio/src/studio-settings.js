export const YUNSOFT_LIGHT_LOGO_URL = 'https://yunsoft.com/light-logo.png';
export const YUNSOFT_DARK_LOGO_URL = 'https://yunsoft.com/dark-logo.png';

export const DEFAULT_STUDIO_SETTINGS = Object.freeze({
  brand_name: 'YunCMS',
  logo_url: YUNSOFT_LIGHT_LOGO_URL,
  accent_color: '#2563eb',
  theme: 'system',
  default_locale: 'en',
});

const LOCALE_KEY = 'yuncms.studio.locale';
const THEMES = new Set(['system', 'light', 'dark']);
const LOCALES = new Set(['en', 'tr']);
const ACCENT_PATTERN = /^#[0-9a-f]{6}$/i;

export function normalizeStudioSettings(value = {}) {
  return {
    brand_name: typeof value.brand_name === 'string' && value.brand_name.trim()
      ? value.brand_name.trim()
      : DEFAULT_STUDIO_SETTINGS.brand_name,
    logo_url: typeof value.logo_url === 'string' && value.logo_url.trim()
      ? value.logo_url.trim()
      : DEFAULT_STUDIO_SETTINGS.logo_url,
    accent_color: ACCENT_PATTERN.test(value.accent_color || '')
      ? value.accent_color.toLowerCase()
      : DEFAULT_STUDIO_SETTINGS.accent_color,
    theme: THEMES.has(value.theme) ? value.theme : DEFAULT_STUDIO_SETTINGS.theme,
    default_locale: LOCALES.has(value.default_locale)
      ? value.default_locale
      : DEFAULT_STUDIO_SETTINGS.default_locale,
    updated_at: value.updated_at ?? null,
  };
}

export function readLocalePreference() {
  if (typeof window === 'undefined') return null;
  const locale = window.localStorage.getItem(LOCALE_KEY);
  return LOCALES.has(locale) ? locale : null;
}

export function writeLocalePreference(locale) {
  if (typeof window === 'undefined') return;
  if (locale == null) {
    window.localStorage.removeItem(LOCALE_KEY);
    return;
  }
  if (!LOCALES.has(locale)) throw new Error(`Unsupported Studio locale: ${locale}`);
  window.localStorage.setItem(LOCALE_KEY, locale);
}

export function resolveTheme(theme, prefersDark = false) {
  if (theme === 'dark') return 'dark';
  if (theme === 'light') return 'light';
  return prefersDark ? 'dark' : 'light';
}

export function resolveStudioLogo(settings, resolvedTheme = 'light') {
  const normalized = normalizeStudioSettings(settings);
  const isYunsoftDefault = normalized.logo_url === YUNSOFT_LIGHT_LOGO_URL
    || normalized.logo_url === YUNSOFT_DARK_LOGO_URL;
  if (!isYunsoftDefault) return normalized.logo_url;

  // Asset names describe the logo artwork, not the surface it belongs on.
  // The light artwork is for dark surfaces; the dark artwork is for light surfaces.
  return resolvedTheme === 'dark' ? YUNSOFT_LIGHT_LOGO_URL : YUNSOFT_DARK_LOGO_URL;
}

export function applyStudioAppearance(settings, prefersDark = false) {
  if (typeof document === 'undefined') return;
  const normalized = normalizeStudioSettings(settings);
  const root = document.documentElement;
  root.dataset.theme = resolveTheme(normalized.theme, prefersDark);
  root.style.setProperty('--studio-accent', normalized.accent_color);
  root.style.setProperty('--studio-accent-soft', `${normalized.accent_color}18`);
  root.style.setProperty('--studio-accent-border', `${normalized.accent_color}55`);
}
