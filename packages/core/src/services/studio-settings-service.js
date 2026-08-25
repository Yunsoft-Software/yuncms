import { BaseService } from './base-service.js';

const THEMES = new Set(['system', 'light', 'dark']);
const LOCALES = new Set(['en', 'tr']);
const ACCENT_PATTERN = /^#[0-9a-f]{6}$/i;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const YUNSOFT_LOGOS = new Set([
  'https://yunsoft.com/light-logo.png',
  'https://yunsoft.com/dark-logo.png',
]);

function invalid(message) {
  const error = new Error(message);
  error.code = 'INVALID_PAYLOAD';
  return error;
}

function notFound(message) {
  const error = new Error(message);
  error.code = 'NOT_FOUND';
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
  const normalized = String(value ?? '').trim();
  if (!YUNSOFT_LOGOS.has(normalized)) {
    throw invalid('External logo URLs are not supported; choose an image from Files');
  }
  return normalized;
}

function normalizeImageFile(value, label) {
  if (value == null || value === '') return null;
  const normalized = String(value).trim();
  if (!UUID_PATTERN.test(normalized)) throw invalid(`${label} file id must be a UUID`);
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

function normalizeBoolean(value, label) {
  if (value === true || value === false) return value;
  throw invalid(`${label} must be a boolean`);
}

function normalizeRegistrationRole(value) {
  if (value == null || value === '') return null;
  const normalized = String(value).trim();
  if (!UUID_PATTERN.test(normalized)) throw invalid('Public registration role id must be a UUID');
  return normalized;
}

function publicSettings(row) {
  return {
    brand_name: row.brand_name,
    logo_url: row.logo_url,
    logo_file: row.logo_file ?? null,
    favicon_file: row.favicon_file ?? null,
    accent_color: row.accent_color,
    theme: row.theme,
    default_locale: row.default_locale,
    public_registration_enabled: Boolean(row.public_registration_enabled),
    updated_at: row.updated_at ?? null,
  };
}

function managedSettings(row) {
  return {
    ...publicSettings(row),
    public_registration_role: row.public_registration_role ?? null,
  };
}

export class StudioSettingsService extends BaseService {
  async #readSettingsRow() {
    const [rows] = await this.database.query(
      `SELECT brand_name, logo_url, logo_file, favicon_file, accent_color, theme, default_locale,
              public_registration_enabled, public_registration_role, updated_at
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
    return row;
  }

  async readPublic() {
    return publicSettings(await this.#readSettingsRow());
  }

  async readOne() {
    assertManager(this.accountability);
    return managedSettings(await this.#readSettingsRow());
  }

  async readImageAssetContent(settingKey, label) {
    const settings = await this.readPublic();
    const fileId = settings[settingKey];
    if (!fileId) throw notFound(`No file-backed Studio ${label.toLowerCase()} is configured`);
    if (!this.storage) throw new Error(`StudioSettingsService requires storage to read a file-backed ${label.toLowerCase()}`);

    const [rows] = await this.database.query(
      `SELECT id, storage, filename_disk, mimetype, filesize
       FROM yuncms_files
       WHERE id = ?
       LIMIT 1`,
      [fileId],
    );
    const file = rows[0];
    if (!file) throw notFound(`Configured Studio ${label.toLowerCase()} file does not exist`);
    if (!String(file.mimetype || '').toLowerCase().startsWith('image/')) {
      throw invalid(`Configured Studio ${label.toLowerCase()} must be an image`);
    }

    const driver = this.storage.get(file.storage);
    const contents = await driver.get(file.filename_disk);
    return { file, contents };
  }

  async readLogoContent() {
    return this.readImageAssetContent('logo_file', 'Logo');
  }

  async readFaviconContent() {
    return this.readImageAssetContent('favicon_file', 'Favicon');
  }

  async validateSelectedImage(fileId, label) {
    if (!fileId) return;
    const [files] = await this.database.query(
      'SELECT id, mimetype FROM yuncms_files WHERE id = ? LIMIT 1',
      [fileId],
    );
    if (!files[0]) throw invalid(`Selected ${label.toLowerCase()} file does not exist`);
    if (!String(files[0].mimetype || '').toLowerCase().startsWith('image/')) {
      throw invalid(`Selected ${label.toLowerCase()} file must be an image`);
    }
  }

  async validateRegistrationRole(roleId) {
    if (!roleId) return;
    const [roles] = await this.database.query(
      'SELECT id, admin, public FROM yuncms_roles WHERE id = ? LIMIT 1',
      [roleId],
    );
    const role = roles[0];
    if (!role) throw invalid('Selected public registration role does not exist');
    if (role.admin) throw invalid('Administrator roles cannot be used for public registration');
    if (role.public) throw invalid('The unauthenticated public role cannot be used for registered users');
  }

  async updateOne(patch = {}) {
    assertManager(this.accountability);
    if (!patch || typeof patch !== 'object' || Array.isArray(patch)) throw invalid('Studio settings patch must be an object');

    const keys = Object.keys(patch);
    const allowed = new Set([
      'brand_name',
      'logo_url',
      'logo_file',
      'favicon_file',
      'accent_color',
      'theme',
      'default_locale',
      'public_registration_enabled',
      'public_registration_role',
    ]);
    if (keys.length === 0 || keys.some((key) => !allowed.has(key))) {
      throw invalid('Studio settings patch contains unsupported properties');
    }

    let normalizedRegistrationEnabled;
    let normalizedRegistrationRole;
    if (Object.hasOwn(patch, 'public_registration_enabled') || Object.hasOwn(patch, 'public_registration_role')) {
      const current = await this.readOne();
      normalizedRegistrationEnabled = Object.hasOwn(patch, 'public_registration_enabled')
        ? normalizeBoolean(patch.public_registration_enabled, 'Public registration enabled')
        : current.public_registration_enabled;
      normalizedRegistrationRole = Object.hasOwn(patch, 'public_registration_role')
        ? normalizeRegistrationRole(patch.public_registration_role)
        : current.public_registration_role;
      await this.validateRegistrationRole(normalizedRegistrationRole);
      if (normalizedRegistrationEnabled && !normalizedRegistrationRole) {
        throw invalid('A non-administrator role must be selected before public registration can be enabled');
      }
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
    if (Object.hasOwn(patch, 'logo_file')) {
      const fileId = normalizeImageFile(patch.logo_file, 'Logo');
      await this.validateSelectedImage(fileId, 'Logo');
      assignments.push('logo_file = ?');
      params.push(fileId);
    }
    if (Object.hasOwn(patch, 'favicon_file')) {
      const fileId = normalizeImageFile(patch.favicon_file, 'Favicon');
      await this.validateSelectedImage(fileId, 'Favicon');
      assignments.push('favicon_file = ?');
      params.push(fileId);
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
    if (Object.hasOwn(patch, 'public_registration_enabled')) {
      assignments.push('public_registration_enabled = ?');
      params.push(normalizedRegistrationEnabled ? 1 : 0);
    }
    if (Object.hasOwn(patch, 'public_registration_role')) {
      assignments.push('public_registration_role = ?');
      params.push(normalizedRegistrationRole);
    }

    params.push(1);
    await this.database.query(
      `UPDATE yuncms_studio_settings SET ${assignments.join(', ')} WHERE id = ?`,
      params,
    );
    return this.readOne();
  }
}

export const STUDIO_SETTING_DEFAULTS = Object.freeze({
  brand_name: 'YunCMS',
  logo_url: 'https://yunsoft.com/light-logo.png',
  logo_file: null,
  favicon_file: null,
  accent_color: '#2563eb',
  theme: 'system',
  default_locale: 'en',
  public_registration_enabled: false,
  public_registration_role: null,
});
