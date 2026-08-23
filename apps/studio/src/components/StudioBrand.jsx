import { useState } from 'react';

import { API_URL } from '../api.js';
import { useStudioSettings } from '../contexts/StudioSettingsContext.jsx';
import { useI18n } from '../i18n.js';
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
  return (
    <div className={`language-switcher ${compact ? 'compact' : ''}`} role="group" aria-label={t('appearance.currentLanguage')}>
      <button
        className={locale === 'en' ? 'active' : ''}
        type="button"
        onClick={() => setLocale('en')}
        aria-pressed={locale === 'en'}
      >
        EN
      </button>
      <button
        className={locale === 'tr' ? 'active' : ''}
        type="button"
        onClick={() => setLocale('tr')}
        aria-pressed={locale === 'tr'}
      >
        TR
      </button>
    </div>
  );
}

export { absoluteLogoUrl };
