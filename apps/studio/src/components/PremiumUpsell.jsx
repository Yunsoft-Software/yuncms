import { useStudioSettings } from '../contexts/StudioSettingsContext.jsx';
import { useI18n } from '../i18n.js';
import { SidebarIcon } from './SidebarIcon.jsx';
import { premiumCatalogUrl } from '../upgrade-link.js';

export function PremiumUpsell({ compact = false }) {
  const { settings } = useStudioSettings();
  const { t, locale } = useI18n();
  if (settings.premium || settings.white_label_enabled) return null;
  return <a className={`premium-upsell${compact ? ' compact' : ''}`} href={premiumCatalogUrl(locale)}
    target="_blank" rel="noopener noreferrer" aria-label={t('features.getPremium')} title={compact ? t('features.getPremium') : undefined}>
    <SidebarIcon name="ai" size={17} /><span>{t('features.getPremium')}</span>
  </a>;
}
