import { useEffect, useState } from 'react';
import { apiRequest } from '../api.js';
import { useI18n } from '../i18n.js';
import { studioPath } from '../studio-route.js';
import { Pagination } from './Pagination.jsx';

export function FlowList({ state, onStateChange, onNew, onImport }) {
  const { t, locale } = useI18n();
  const [rows, setRows] = useState([]), [total, setTotal] = useState(0), [loading, setLoading] = useState(true), [error, setError] = useState(''), [canManage, setCanManage] = useState(false);
  const { page, pageSize, search, status, trigger } = state;
  useEffect(() => {
    let active = true; setLoading(true); setError('');
    const query = new URLSearchParams({ limit: pageSize, offset: (page - 1) * pageSize, summary: '1', meta: 'filter_count', ...(search ? { search } : {}), ...(status ? { status } : {}), ...(trigger ? { trigger } : {}) });
    Promise.all([apiRequest(`/flows?${query}`), apiRequest('/flows/access')]).then(([result, access]) => {
      if (!active) return;
      setCanManage(access.data.manage === true);
      const count = result.meta.filter_count, lastPage = Math.max(1, Math.ceil(count / pageSize));
      if (page > lastPage) { onStateChange({ ...state, page: lastPage }); return; }
      setRows(result.data); setTotal(count);
    }).catch(failure => { if (active) setError(failure.message); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [page, pageSize, search, status, trigger]);
  function update(patch) {
    if (Object.keys(patch).every(key => state[key] === patch[key])) return;
    setRows([]); setLoading(true); onStateChange({ ...state, ...patch });
  }
  const filter = patch => update({ ...patch, page: 1 });
  return <section className="flows-workspace" aria-label={t('flow.title')}>
    <header className="flow-heading"><div><h1>{t('flow.title')}</h1><p>{t('flow.listHint')}</p></div><div className="flow-toolbar-actions">{canManage && <>
      <button type="button" className="secondary-button" onClick={onImport}>{t('flow.import')}</button>
      <button type="button" className="primary-button" onClick={onNew}>{t('flow.new')}</button>
    </>}</div></header>
    <div className="flow-catalogue-filters">
      <label className="field-label"><span>{t('flow.search')}</span><input type="search" maxLength={200} value={search} onChange={event => filter({ search: event.target.value })} /></label>
      <label className="field-label"><span>{t('flow.status')}</span><select value={status} onChange={event => filter({ status: event.target.value })}><option value="">{t('flow.allStatuses')}</option>{['active', 'inactive'].map(value => <option value={value} key={value}>{t(`flow.${value}`)}</option>)}</select></label>
      <label className="field-label"><span>{t('flow.triggerLabel')}</span><select value={trigger} onChange={event => filter({ trigger: event.target.value })}><option value="">{t('flow.allTriggers')}</option>{['manual', 'event', 'webhook', 'schedule', 'operation'].map(value => <option value={value} key={value}>{t(`flow.trigger.${value}`)}</option>)}</select></label>
    </div>
    {error && <div className="error-banner" role="alert">{error}</div>}
    <div className="flow-catalogue" aria-busy={loading}>
      {loading && <p role="status">{t('common.loading')}</p>}
      {!loading && !rows.length && !error && <p>{search || status || trigger ? t('flow.noMatches') : t('flow.empty')}</p>}
      {rows.length > 0 && <div className="table-scroll"><table className="data-table"><thead><tr><th>{t('common.name')}</th><th>{t('flow.triggerLabel')}</th><th>{t('flow.status')}</th><th>{t('flow.updatedAt')}</th></tr></thead><tbody>
        {rows.map(flow => <tr key={flow.id}><td><a className="flow-name-link" href={studioPath.flow(flow.id)}>{flow.name}</a></td><td>{t(`flow.trigger.${flow.trigger}`)}</td><td><span className={`flow-status flow-status-${flow.status}`}>{t(`flow.${flow.status}`)}</span></td><td>{flow.updated_at ? new Date(flow.updated_at).toLocaleString(locale) : '—'}</td></tr>)}
      </tbody></table></div>}
      <Pagination page={page} pageSize={pageSize} totalItems={total} loading={loading} itemLabel={t('flow.items')}
        pageSizeOptions={[10, 20]} onPageChange={next => update({ page: next })} onPageSizeChange={next => filter({ pageSize: next })} />
    </div>
  </section>;
}
