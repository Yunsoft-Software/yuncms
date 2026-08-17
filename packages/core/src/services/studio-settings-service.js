import { BaseService } from './base-service.js';

const THEMES = new Set(['system', 'light', 'dark']);
const LOCALES = new Set(['en', 'tr']);
const ACCENT_PATTERN = /^#[0-9a-f]{6}$/i;

function invalid(message) {
  const error = new Error(message);
  error.code = 'INVALID_PAYLOAD';
  return error;
}

function assertManager(accountability) {
  if (accountability.admin === true || accountability.system === true) return;
  const error = new Error('Studio settings require administrator accountability');
  error.code = 'FORBIDDEN';
  throw error;
}

function normalizeBrandName(value) {
  if (typeof value !== 'string' || !value.trim()) throw invalid('Brand name is required');
  const normalized = value.trim();
  if (normalized.length > 100) throw invalid('Brand name cannot exceed 100 characters');
  return normalized;
}

function normalizeLogoUrl(value) {
  if (typeof value !== 'string' || !value.trim()) throw invalid('Logo URL is required');
  const normalized = value.trim();
  if (normalized.length > 512) throw invalid('Logo URL cannot exceed 512 characters');
  let url;
  try {
    url = new URL(normalized);
  } catch {
    throw invalid('Logo URL must be a valid URL');
  }
  if (!['http:', 'https:'].includes(url.protocol)) throw invalid('Logo URL must use HTTP or HTTPS');
  return normalized;
}

function normalizeAccent(value) {
  const normalized = String(value ?? '').trim();
  if (!ACCENT_PATTERN.test(normalized)) throw invalid('Accent color must be a six-digit hex color');
  return normalized.toLowerCase();
}

function normalizeTheme(value) {
  const normalized = String(value ?? '').trim().toLowerCase();
  if (!THEMES.has(normalized)) throw invalid('Theme must be system, light or dark');
  return normalized;
}

function normalizeLocale(value) {
  const normalized = String(value ?? '').trim().toLowerCase();
  if (!LOCALES.has(normalized)) throw invalid('Default locale must be en or tr');
  return normalized;
}

function publicSettings(row) {
  return {
    brand_name: row.brand_name,
    logo_url: row.logo_url,
    accent_color: row.accent_color,
    theme: row.theme,
    default_locale: row.default_locale,
    updated_at: row.updated_at ?? null,
  };
}

export class StudioSettingsService extends BaseService {
  async readPublic() {
    const [rows] = await this.database.query(
      `SELECT brand_name, logo_url, accent_color, theme, default_locale, updated_at
       FROM yuncms_studio_settings
       WHERE id = 1
       LIMIT 1`,
    );
    const row = rows[0];
    if (!row) {
      const error = new Error('Studio settings are missing; run YunCMS bootstrap');
      error.code = 'DATABASE_MIGRATION_REQUIRED';
      throw error;
    }
    return publicSettings(row);
  }

  async readOne() {
    assertManager(this.accountability);
    return this.readPublic();
  }

  async updateOne(patch = {}) {
    assertManager(this.accountability);
    if (!patch || typeof patch !== 'object' || Array.isArray(patch)) throw invalid('Studio settings patch must be an object');

    const keys = Object.keys(patch);
    const allowed = new Set(['brand_name', 'logo_url', 'accent_color', 'theme', 'default_locale']);
    if (keys.length === 0 || keys.some((key) => !allowed.has(key))) {
      throw invalid('Studio settings patch contains unsupported properties');
    }

    const assignments = [];
    const params = [];
    if (Object.hasOwn(patch, 'brand_name')) {
      assignments.push('brand_name = ?');
      params.push(normalizeBrandName(patch.brand_name));
    }
    if (Object.hasOwn(patch, 'logo_url')) {
      assignments.push('logo_url = ?');
      params.push(normalizeLogoUrl(patch.logo_url));
    }
    if (Object.hasOwn(patch, 'accent_color')) {
      assignments.push('accent_color = ?');
      params.push(normalizeAccent(patch.accent_color));
    }
    if (Object.hasOwn(patch, 'theme')) {
      assignments.push('theme = ?');
      params.push(normalizeTheme(patch.theme));
    }
    if (Object.hasOwn(patch, 'default_locale')) {
      assignments.push('default_locale = ?');
      params.push(normalizeLocale(patch.default_locale));
    }

    params.push(1);
    await this.database.query(
      `UPDATE yuncms_studio_settings SET ${assignments.join(', ')} WHERE id = ?`,
      params,
    );
    return this.readPublic();
  }
}

export const STUDIO_SETTING_DEFAULTS = Object.freeze({
  brand_name: 'YunCMS',
  logo_url: 'https://yunsoft.com/light-logo.png',
  accent_color: '#2563eb',
  theme: 'system',
  default_locale: 'en',
});
