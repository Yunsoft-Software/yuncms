import { useEffect, useState } from 'react';
import { apiRequest } from '../api.js';
import { useI18n } from '../i18n.js';
import { navigateStudio, studioPath } from '../studio-route.js';
import { useConfirmDialog } from './DialogProvider.jsx';

export function FlowLegacyAutomations({ initiallyOpen = false }) {
  const { t, locale } = useI18n(), confirmAction = useConfirmDialog();
  const [rules, setRules] = useState([]), [runs, setRuns] = useState(null), [busy, setBusy] = useState(false), [error, setError] = useState('');
  useEffect(() => { let active = true; apiRequest('/automations').then(result => { if (active) setRules(result.data); }).catch(failure => { if (active) setError(failure.message); }); return () => { active = false; }; }, []);
  async function convert(rule) {
    if (!await confirmAction({ title: t('flow.convertAi'), description: t('flow.legacyHint') })) return;
    setBusy(true); setError('');
    try { const result = await apiRequest(`/automations/${encodeURIComponent(rule.id)}/convert-to-flow`, { method: 'POST' }); navigateStudio(studioPath.flow(result.data.id)); }
    catch (failure) { setError(failure.message); } finally { setBusy(false); }
  }
  if (!rules.length && !error) return null;
  return <details className="flow-legacy" open={initiallyOpen || undefined}><summary>{t('flow.legacyAi')} <span>{rules.length}</span></summary>
    <p>{t('flow.legacyHint')}</p>
    {error && <div className="error-banner" role="alert">{error}</div>}
    <div className="flow-legacy-list">{rules.map(rule => <article key={rule.id}><div><strong>{rule.name}</strong><small>{rule.collection} · {t(rule.enabled ? 'flow.active' : 'flow.inactive')}</small></div><div className="flow-toolbar-actions">
      <button className="secondary-button" type="button" disabled={busy} onClick={async () => { try { setRuns({ name: rule.name, rows: (await apiRequest(`/automations/${rule.id}/runs`)).data }); } catch (failure) { setError(failure.message); } }}>{t('flow.runs')}</button>
      {rule.flow_id ? <a className="secondary-button" href={studioPath.flow(rule.flow_id)}>{t('flow.openFlow')}</a> : <button className="secondary-button" type="button" disabled={busy} onClick={() => convert(rule)}>{t('flow.convertAi')}</button>}
    </div></article>)}</div>
    {runs && <section className="flow-legacy-history"><h3>{runs.name} · {t('flow.runs')}</h3>{!runs.rows.length && <p>{t('automation.noRuns')}</p>}{runs.rows.map(run => <div className="flow-legacy-run" key={run.id}><code>{run.item_key}</code><span>{t(`flow.${run.status}`)}</span><time>{new Date(run.created_at).toLocaleString(locale)}</time>{run.error_code && <code>{run.error_code}</code>}</div>)}</section>}
  </details>;
}
