import { useEffect, useState } from 'react';
import { apiRequest } from '../api.js';
import { useI18n } from '../i18n.js';
import { useStudioSettings } from '../contexts/StudioSettingsContext.jsx';
import { PremiumUpsell } from '../components/index.js';

export function FeaturesScreen() {
  const { t } = useI18n();
  const { settings, refreshSettings } = useStudioSettings();
  const [collections, setCollections] = useState([]), [selected, setSelected] = useState('');
  const [status, setStatus] = useState(null), [token, setToken] = useState('');
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState('');
  useEffect(() => {
    let active = true;
    Promise.all([apiRequest('/features'), apiRequest('/schema/collections')]).then(([result, schema]) => {
      if (active) { setStatus(result.data); const project = schema.data.filter(row => !row.system); setCollections(project); setSelected(project[0]?.collection ?? ''); }
    })
      .catch(failure => { if (active) setError(failure.message); });
    return () => { active = false; };
  }, []);
  async function change(path, body) {
    const previous = status;
    if (path !== '/features/license') {
      const name = path.split('/').at(-1);
      setStatus(current => ({ ...current, features: { ...current.features, [name]: { ...current.features[name], enabled: body.enabled } } }));
    }
    setBusy(true); setError(''); setNotice('');
    try {
      await apiRequest(path, { method: path === '/features/license' ? 'POST' : 'PATCH', body });
      if (path === '/features/license') setToken('');
      setStatus((await apiRequest('/features')).data);
      await refreshSettings();
      setNotice(t('common.saved'));
    } catch (failure) { setStatus(previous); setError(failure.message); }
    finally { setBusy(false); }
  }
  const selectedCollection = collections.find(row => row.collection === selected);
  async function saveHistory(enabled) {
    const previous = collections;
    setCollections(rows => rows.map(row => row.collection === selected ? { ...row, metadata: { ...row.metadata, contentTracking: { enabled: enabled || row.metadata?.contentTracking?.enabled, history: enabled } } } : row));
    setBusy(true); setError(''); setNotice('');
    try {
      const current = (await apiRequest(`/schema/collections/${encodeURIComponent(selected)}`)).data;
      const tracking = current.metadata?.contentTracking ?? { enabled: true, history: false };
      const saved = await apiRequest(`/schema/collections/${encodeURIComponent(selected)}`, { method: 'PATCH', body: { metadata: { ...current.metadata, contentTracking: { enabled: enabled || tracking.enabled, history: enabled } } } });
      setCollections(rows => rows.map(row => row.collection === selected ? saved.data : row)); setNotice(t('common.saved'));
    } catch (failure) { setCollections(previous); setError(failure.message); }
    finally { setBusy(false); }
  }
  return <div className="settings-feature-page">
    <header className="page-header"><div><p className="eyebrow">{settings.brand_name}</p><h1>{t('features.title')}</h1><p>{t('features.description')}</p></div><PremiumUpsell /></header>
    {error && <div className="error-banner" role="alert">{error}</div>}
    {notice && <div className="notice-banner" role="status">{notice}</div>}
    {!status ? <section className="panel empty-state">{t('common.loading')}</section> : <>
      <section className="panel form-panel"><div className="panel-heading"><div><h2>{t('features.available')}</h2><p>{t('features.controls')}</p></div></div>
        <div className="settings-feature-list">{Object.entries(status.features).map(([name, feature]) => <div className="settings-feature-row" key={name}>
          <div className="settings-feature-copy"><strong>{t(`features.${name}`)}</strong><span>{t(`features.${feature.tier}`)}</span>
            {feature.reason && <p>{t(`features.${feature.reason}`)}</p>}</div>
          <label className="checkbox-label"><input type="checkbox" aria-label={t(`features.${name}`)} checked={feature.enabled} disabled={busy || !feature.allowed} onChange={event => change(`/features/${name}`, { enabled: event.target.checked })} />{t('features.enabled')}</label>
        </div>)}</div>
      </section>
      {collections.length > 0 && <section className="panel form-panel">
        <div className="panel-heading"><div><h2>{t('features.contentHistory')}</h2><p>{t('features.recordingHint')}</p></div></div>
        <label className="field-label">{t('features.collection')}<select aria-label={t('features.collection')} value={selected} onChange={event => setSelected(event.target.value)} disabled={busy}>{collections.map(row => <option key={row.collection} value={row.collection}>{row.name || row.collection}</option>)}</select></label>
        <label className="checkbox-label"><input type="checkbox" aria-label={t('features.recording')} checked={selectedCollection?.metadata?.contentTracking?.history === true} disabled={busy || !status.features.contentHistory.enabled} onChange={event => saveHistory(event.target.checked)} />{t('features.recording')}</label>
      </section>}
      <form className="panel form-panel" onSubmit={event => { event.preventDefault(); change('/features/license', { token: token.trim() }); }}>
        <div className="panel-heading"><div><h2>{t('features.license')}</h2><p>{t('features.perpetual')}</p></div><span className="status-pill">{t(`features.${status.license?.status ?? 'missing'}`)}</span></div>
        <label className="field-label">{t('features.token')}<textarea value={token} onChange={event => setToken(event.target.value)} rows={4} spellCheck={false} autoComplete="off" disabled={busy} /></label>
        <div className="form-actions"><button className="primary-button" type="submit" disabled={busy || !token.trim()}>{t('features.activate')}</button></div>
      </form>
    </>}
  </div>;
}
