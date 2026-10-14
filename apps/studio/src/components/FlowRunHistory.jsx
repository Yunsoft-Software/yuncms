import { useI18n } from '../i18n.js';
export function FlowRunHistory({ runs, selected, onSelect }) {
  const { t } = useI18n();
  return <section className="flow-history" aria-label={t('flow.runs')}><h2>{t('flow.runs')}</h2>
    {!runs.length && <p>{t('flow.noRuns')}</p>}
    <div className="flow-history-list">{runs.map(run => <button type="button" key={run.id} className={`flow-history-entry ${selected?.id === run.id ? 'active' : ''}`} onClick={() => onSelect(run)}>
      <span className={`flow-status flow-status-${run.status}`}>{t(`flow.${run.status}`)}</span><time>{new Date(run.created_at).toLocaleString()}</time>{run.error_code && <code>{run.error_code}</code>}
    </button>)}</div>
    {selected && <div className="flow-run-detail"><div className="flow-run-steps">{(selected.trace ?? []).map((step, index) => <div className={`flow-run-step flow-step-${step.status}`} key={`${step.id}:${index}`}>
      <strong>{index + 1}. {step.key}</strong><span>{t(`flow.${step.status}`)} · {step.duration_ms} ms</span><pre>{JSON.stringify(step.output, null, 2)}</pre>
    </div>)}</div><div><h3>{t('flow.result')}</h3><pre data-testid="flow-run-output">{JSON.stringify(selected.output, null, 2)}</pre></div></div>}
  </section>;
}
