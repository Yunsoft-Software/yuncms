import { useState } from 'react';
import { useI18n } from '../i18n.js';

export const YUNCMS_GITHUB = 'https://github.com/Yunsoft-Software/yuncms';
export const YUNCMS_SPONSORS = 'https://github.com/sponsors/Yunsoft-Software';
export function yunsoftContact(source) {
  const url = new URL('https://yunsoft.com/contact');
  url.searchParams.set('utm_source', source);
  url.searchParams.set('utm_medium', 'yuncms');
  url.searchParams.set('utm_campaign', 'yuncms-services');
  return url.toString();
}

export function YunsoftSupportLinks({ source = 'studio' }) {
  const { t } = useI18n();
  return <div className="yunsoft-support-links">
    <a href={yunsoftContact(source)} target="_blank" rel="noopener noreferrer">{t('support.contact')} ↗</a>
    <a href={YUNCMS_GITHUB} target="_blank" rel="noopener noreferrer">{t('support.star')} ↗</a>
    <a href={YUNCMS_SPONSORS} target="_blank" rel="noopener noreferrer">{t('support.sponsor')} ↗</a>
  </div>;
}

export function YunsoftSupportCard() {
  const { t } = useI18n();
  const [dismissed, setDismissed] = useState(() => {
    try { return localStorage.getItem('yuncms.support-dismissed') === '1'; } catch { return false; }
  });
  if (dismissed) return null;
  return <aside className="yunsoft-support-card" aria-label={t('support.title')}>
    <button className="text-button" type="button" aria-label={t('common.close')} onClick={() => {
      setDismissed(true); try { localStorage.setItem('yuncms.support-dismissed', '1'); } catch { /* Optional presentation preference. */ }
    }}>×</button>
    <strong>{t('support.title')}</strong><p>{t('support.description')}</p><YunsoftSupportLinks />
  </aside>;
}
