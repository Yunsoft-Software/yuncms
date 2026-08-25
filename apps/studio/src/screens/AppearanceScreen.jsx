import { useEffect, useState } from 'react';

import { BrandAssetPicker } from '../components/BrandAssetPicker.jsx';
import { PublicRegistrationSettings } from '../components/PublicRegistrationSettings.jsx';
import { LanguageSwitcher, StudioBrand, YunsoftFooter } from '../components/StudioBrand.jsx';
import { useStudioSettings } from '../contexts/StudioSettingsContext.jsx';
import { useI18n } from '../i18n.js';
import {
  DEFAULT_STUDIO_SETTINGS,
  YUNSOFT_DARK_LOGO_URL,
  YUNSOFT_LIGHT_LOGO_URL,
} from '../studio-settings.js';

export function AppearanceScreen() {
  const {
    settings,
    localeOverride,
    loadError,
    saveSettings,
    useDefaultLocale,
  } = useStudioSettings();
  const { t } = useI18n();
  const [form, setForm] = useState(settings);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  useEffect(() => setForm(settings), [settings]);

  function update(key, value) {
    setForm((current) => ({ ...current, [key]: value }));
    setError('');
    setNotice('');
  }

  async function handleSave(event) {
    event.preventDefault();
    setSaving(true);
    setError('');
    setNotice('');
    try {
      const patch = {
        brand_name: form.brand_name,
        logo_file: form.logo_file || null,
        favicon_file: form.favicon_file || null,
        accent_color: form.accent_color,
        theme: form.theme,
        default_locale: form.default_locale,
      };
      if ([YUNSOFT_LIGHT_LOGO_URL, YUNSOFT_DARK_LOGO_URL].includes(form.logo_url)) {
        patch.logo_url = form.logo_url;
      }
      await saveSettings(patch);
      setNotice(t('appearance.saved'));
    } catch (requestError) {
      setError(requestError.message || t('auth.requestFailed'));
    } finally {
      setSaving(false);
    }
  }

  function resetBranding() {
    setForm((current) => ({
      ...current,
      brand_name: DEFAULT_STUDIO_SETTINGS.brand_name,
      logo_url: DEFAULT_STUDIO_SETTINGS.logo_url,
      logo_file: null,
      favicon_file: null,
      accent_color: DEFAULT_STUDIO_SETTINGS.accent_color,
    }));
    setError('');
    setNotice('');
  }

  return (
    <div className="appearance-layout">
      <div className="form-stack">
        <form className="panel appearance-form" onSubmit={handleSave}>
          <div className="panel-header appearance-heading">
            <div>
              <p className="eyebrow">{t('appearance.branding')}</p>
              <h2>{t('section.appearanceTitle')}</h2>
              <p>{t('section.appearanceDescription')}</p>
            </div>
            <button className="secondary-button" type="button" onClick={resetBranding}>
              {t('appearance.resetYunsoft')}
            </button>
          </div>

          {loadError && <div className="notice-banner" role="status">{t('appearance.loadWarning')}</div>}
          {error && <div className="error-banner" role="alert">{error}</div>}
          {notice && <div className="notice-banner" role="status">{notice}</div>}

          <div className="appearance-grid">
            <label className="field-label">
              <span>{t('appearance.brandName')}</span>
              <input
                value={form.brand_name || ''}
                maxLength={100}
                onChange={(event) => update('brand_name', event.target.value)}
                required
              />
              <small>{t('appearance.brandNameHint')}</small>
            </label>

            <div className="appearance-brand-assets">
              <BrandAssetPicker
                kind="logo"
                value={form.logo_file || null}
                onChange={(fileId) => update('logo_file', fileId)}
              />
              <BrandAssetPicker
                kind="favicon"
                value={form.favicon_file || null}
                onChange={(fileId) => update('favicon_file', fileId)}
              />
            </div>

            <label className="field-label">
              <span>{t('appearance.accentColor')}</span>
              <div className="color-field">
                <input
                  type="color"
                  value={form.accent_color || DEFAULT_STUDIO_SETTINGS.accent_color}
                  onChange={(event) => update('accent_color', event.target.value)}
                  aria-label={t('appearance.accentColor')}
                />
                <input
                  value={form.accent_color || ''}
                  pattern="#[0-9A-Fa-f]{6}"
                  maxLength={7}
                  onChange={(event) => update('accent_color', event.target.value)}
                  required
                />
              </div>
            </label>

            <label className="field-label">
              <span>{t('appearance.theme')}</span>
              <select value={form.theme || 'system'} onChange={(event) => update('theme', event.target.value)}>
                <option value="system">{t('appearance.themeSystem')}</option>
                <option value="light">{t('appearance.themeLight')}</option>
                <option value="dark">{t('appearance.themeDark')}</option>
              </select>
            </label>

            <label className="field-label">
              <span>{t('appearance.defaultLanguage')}</span>
              <select
                value={form.default_locale || 'en'}
                onChange={(event) => update('default_locale', event.target.value)}
              >
                <option value="en">{t('appearance.english')}</option>
                <option value="tr">{t('appearance.turkish')}</option>
              </select>
              <small>{t('appearance.defaultLanguageHint')}</small>
            </label>

            <div className="field-label appearance-personal-language">
              <span>{t('appearance.currentLanguage')}</span>
              <LanguageSwitcher />
              {localeOverride && (
                <button className="text-button" type="button" onClick={useDefaultLocale}>
                  {t('appearance.followDefault')}
                </button>
              )}
            </div>
          </div>

          <div className="form-actions">
            <button className="primary-button" type="submit" disabled={saving}>
              {saving ? t('common.saving') : t('common.save')}
            </button>
          </div>
        </form>

        <PublicRegistrationSettings />
      </div>

      <aside className="panel appearance-preview" aria-label={t('appearance.preview')}>
        <p className="eyebrow">{t('appearance.preview')}</p>
        <div className="appearance-preview-card" style={{ '--preview-accent': form.accent_color }}>
          <StudioBrand previewSettings={form} />
          <div className="appearance-preview-accent" />
          <p>{t('section.appearanceDescription')}</p>
          <YunsoftFooter compact />
        </div>
      </aside>
    </div>
  );
}
