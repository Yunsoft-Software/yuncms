import { useState } from 'react';

import { API_URL } from '../api.js';
import { useStudioSettings } from '../contexts/StudioSettingsContext.jsx';
import { useI18n } from '../i18n.js';
import { getEnabledLocaleDefinitions } from '../locale-registry.js';
import { resolveStudioLogo } from '../studio-settings.js';

function absoluteLogoUrl(value) {
  if (!value || !value.startsWith('/')) return value;
  return `${API_URL}${value}`;
}

export function StudioBrand({ compact = false, previewSettings = null }) {
  const { settings, resolvedTheme } = useStudioSettings();
  const effectiveSettings = previewSettings ?? settings;
  const brandName = String(effectiveSettings.brand_name || 'YunCMS').trim() || 'YunCMS';
  const logoUrl = absoluteLogoUrl(resolveStudioLogo(effectiveSettings, resolvedTheme));
  const [failedLogo, setFailedLogo] = useState('');
  const showLogo = logoUrl && failedLogo !== logoUrl;

  return (
    <div className={`studio-brand ${compact ? 'compact' : ''}`} aria-label={effectiveSettings.brand_name}>
      {showLogo ? (
        <img
          className="studio-brand-logo"
          src={logoUrl}
          alt={effectiveSettings.brand_name}
          onError={() => setFailedLogo(logoUrl)}
        />
      ) : (
        <span className="studio-brand-fallback" aria-hidden="true">
          <span className="studio-brand-fallback-full">{brandName}</span>
          <span className="studio-brand-fallback-compact">{brandName.slice(0, 1).toUpperCase()}</span>
        </span>
      )}
    </div>
  );
}

export function AuthBrandPanel() {
  const { t } = useI18n();

  return (
    <div className="auth-branding">
      <div className="auth-branding-head">
        <StudioBrand />
        <LanguageSwitcher compact />
      </div>
      <div className="auth-brand-showcase">
        <div className="auth-brand-visual" aria-hidden="true">
          <span className="auth-brand-orbit auth-brand-orbit-one" />
          <span className="auth-brand-orbit auth-brand-orbit-two" />
          <div className="auth-brand-logo-stage"><StudioBrand /></div>
        </div>
        <div className="auth-brand-copy">
          <p className="eyebrow">{t('auth.brandKicker')}</p>
          <h2>{t('auth.brandTitle')}</h2>
          <p>{t('auth.brandDescription')}</p>
          <div className="auth-brand-capabilities" aria-label={t('auth.brandCapabilities')}>
            <span>{t('auth.brandSchema')}</span>
            <span>{t('auth.brandContent')}</span>
            <span>{t('auth.brandAccess')}</span>
          </div>
        </div>
      </div>
    </div>
  );
}

export function YunsoftFooter({ compact = false }) {
  const { t } = useI18n();
  return (
    <div className={`yunsoft-footer ${compact ? 'compact' : ''}`}>
      <span>{t('appearance.poweredBy')}</span>
      {!compact && <small>{t('appearance.copyright', { year: new Date().getFullYear() })}</small>}
    </div>
  );
}

export function LanguageSwitcher({ compact = false }) {
  const { locale, setLocale, t } = useI18n();
  const localeOptions = getEnabledLocaleDefinitions();

  return (
    <label className={`language-switcher ${compact ? 'compact' : ''}`}>
      <select
        value={locale}
        onChange={(event) => setLocale(event.target.value)}
        aria-label={t('appearance.currentLanguage')}
      >
        {localeOptions.map((option) => (
          <option key={option.code} value={option.code}>{option.nativeName}</option>
        ))}
      </select>
    </label>
  );
}

export { absoluteLogoUrl };
