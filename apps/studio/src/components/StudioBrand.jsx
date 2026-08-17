import { useState } from 'react';

import { useStudioSettings } from '../contexts/StudioSettingsContext.jsx';
import { useI18n } from '../i18n.js';

export function StudioBrand({ compact = false }) {
  const { settings } = useStudioSettings();
  const [failedLogo, setFailedLogo] = useState('');
  const showLogo = settings.logo_url && failedLogo !== settings.logo_url;

  return (
    <div className={`studio-brand ${compact ? 'compact' : ''}`}>
      {showLogo && (
        <img
          className="studio-brand-logo"
          src={settings.logo_url}
          alt={settings.brand_name}
          onError={() => setFailedLogo(settings.logo_url)}
        />
      )}
      <div className="studio-brand-copy">
        <strong>{settings.brand_name}</strong>
        {!compact && <span>Studio</span>}
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
  const { locale, setLocale } = useI18n();
  return (
    <div className={`language-switcher ${compact ? 'compact' : ''}`} role="group" aria-label="Language">
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
