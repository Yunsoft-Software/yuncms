import { useEffect, useState } from 'react';
import { apiRequest } from '../api.js';
import { useI18n } from '../i18n.js';
import { Modal } from './Modal.jsx';
import { Pagination } from './Pagination.jsx';

export function FlowRunHistory({ flowId, open, onClose, onSelect, refreshKey, returnFocusRef }) {
  const { t, locale } = useI18n();
  const [rows, setRows] = useState([]), [total, setTotal] = useState(0), [page, setPage] = useState(1), [pageSize, setPageSize] = useState(10);
  const [loading, setLoading] = useState(false), [detailLoading, setDetailLoading] = useState(false), [error, setError] = useState('');
  const [selectedId, setSelectedId] = useState(''), [selected, setSelected] = useState(null), [refresh, setRefresh] = useState(0);
  useEffect(() => { if (open) { setPage(1); setSelectedId(''); setSelected(null); } }, [open, flowId, refreshKey]);
  useEffect(() => {
    if (!open || !flowId) return;
    let active = true; setLoading(true); setError('');
    const query = new URLSearchParams({ limit: pageSize, offset: (page - 1) * pageSize, summary: '1', meta: 'filter_count' });
    apiRequest(`/flows/${encodeURIComponent(flowId)}/runs?${query}`).then(result => {
      if (!active) return;
      const count = result.meta.filter_count, lastPage = Math.max(1, Math.ceil(count / pageSize));
      if (page > lastPage) { setPage(lastPage); return; }
      setRows(result.data); setTotal(count); setSelectedId(result.data[0]?.id ?? '');
    }).catch(failure => { if (active) setError(failure.message); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [open, flowId, page, pageSize, refresh, refreshKey]);
  useEffect(() => {
    setSelected(null); setDetailLoading(false);
    if (!open || !selectedId) return;
    let active = true; setDetailLoading(true);
    apiRequest(`/flows/${encodeURIComponent(flowId)}/runs/${encodeURIComponent(selectedId)}`).then(result => {
      if (active) { setSelected(result.data); onSelect(result.data); }
    }).catch(failure => { if (active) setError(failure.message); }).finally(() => { if (active) setDetailLoading(false); });
    return () => { active = false; };
  }, [open, flowId, selectedId, refresh, refreshKey, onSelect]);
  function changePage(next) { setRows([]); setLoading(true); setSelectedId(''); setSelected(null); setPage(next); }
  return <Modal open={open} title={t('flow.runs')} eyebrow="" className="flow-history-modal" onClose={onClose} returnFocusRef={returnFocusRef}
    actions={<><button type="button" className="secondary-button" disabled={loading || detailLoading} onClick={() => { setLoading(true); setRefresh(value => value + 1); }}>{t('flow.refresh')}</button><button type="button" className="primary-button" onClick={onClose}>{t('common.close')}</button></>}>
    <section className="flow-history" aria-label={t('flow.runs')} aria-busy={loading}>
      {error && <div className="error-banner" role="alert">{error}</div>}
      {loading && <p role="status">{t('common.loading')}</p>}
      {!loading && !rows.length && !error && <p>{t('flow.noRuns')}</p>}
      <div className="flow-history-layout"><div className="flow-history-list">{rows.map(run => <button type="button" key={run.id} data-run-id={run.id} disabled={loading} className={`flow-history-entry ${selectedId === run.id ? 'active' : ''}`} onClick={() => setSelectedId(run.id)}>
        <span className={`flow-status flow-status-${run.status}`}>{t(`flow.${run.status}`)}</span><time>{new Date(run.created_at).toLocaleString(locale)}</time>{run.error_code && <code>{run.error_code}</code>}
      </button>)}</div>
      <div className="flow-run-detail">
        {detailLoading && <p role="status">{t('common.loading')}</p>}
        {selected && <><div className="flow-run-steps">{(selected.trace ?? []).map((step, index) => <div className={`flow-run-step flow-step-${step.status}`} key={`${step.id}:${index}`}>
          <strong>{index + 1}. {step.key}</strong><span>{t(`flow.${step.status}`)} · {step.duration_ms} ms</span><pre>{JSON.stringify(step.output, null, 2)}</pre>
        </div>)}</div><div><h3>{t('flow.result')}</h3><pre data-testid="flow-run-output">{JSON.stringify(selected.output, null, 2)}</pre></div></>}
      </div></div>
      <Pagination page={page} pageSize={pageSize} totalItems={total} loading={loading} itemLabel={t('flow.runItems')} pageSizeOptions={[10, 20]}
        onPageChange={changePage} onPageSizeChange={next => { if (next === pageSize) return; setRows([]); setLoading(true); setSelectedId(''); setSelected(null); setPageSize(next); setPage(1); }} />
    </section>
  </Modal>;
}
