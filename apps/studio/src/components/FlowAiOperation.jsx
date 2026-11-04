import { useEffect, useRef, useState } from 'react';
import { aiStatus, apiRequest } from '../api.js';
import { setAutomationConstraint, toggleAutomationField } from '../automation-form.js';
import { useI18n } from '../i18n.js';
import { AutomationOutputConstraints } from './AutomationOutputConstraints.jsx';

export function FlowAiOperation({ options, onChange, onValidityChange, flow }) {
  const { t } = useI18n();
  const [configuration, setConfiguration] = useState(null), [error, setError] = useState('');
  const [sample, setSample] = useState(''), [preview, setPreview] = useState(null), [busy, setBusy] = useState(false), [status, setStatus] = useState(null);
  const snapshot = JSON.stringify({ options, runAs: flow.run_as }), latest = useRef(snapshot); latest.current = snapshot;
  useEffect(() => { setPreview(null); }, [snapshot]);
  useEffect(() => { let active = true; Promise.all([apiRequest('/automations/configuration'), aiStatus()]).then(([result, ai]) => { if (active) { setConfiguration(result.data); setStatus(ai); } }).catch(failure => { if (active) setError(failure.message); }); return () => { active = false; }; }, []);
  const collection = configuration?.collections.find(item => item.collection === options.collection);
  const patch = update => { onChange({ ...options, ...update }); onValidityChange?.(true); setError(''); };
  async function testRecord() {
    setBusy(true); setError(''); const expected = snapshot;
    try {
      const { collection, input_fields, output_fields, output_constraints, instruction } = options;
      const result = await apiRequest('/automations/preview', { method: 'POST', body: { item_key: sample, rule: { name: flow.name || 'AI', run_as: flow.run_as, collection, input_fields, output_fields, output_constraints, instruction } } });
      if (latest.current === expected) setPreview(result.data);
    } catch (failure) { if (latest.current === expected) setError(failure.message); } finally { setBusy(false); }
  }
  const toggle = (key, field) => { try { const next = toggleAutomationField(options, key, field); if (Object.keys(next.output_constraints ?? {}).length && next.output_fields.some(output => collection?.fields.find(entry => entry.field === output)?.type === 'json')) { setError(t('automation.constraintsHint')); return; } onChange(next); setError(''); } catch { setError(t('automation.constraintFieldInUse')); } };
  if (!configuration) return <div className="flow-ai-fields" aria-busy={!error}>
    {error ? <p className="error-banner" role="alert">{error}</p> : <p className="flow-ai-hint" role="status">{t('common.loading')}</p>}
  </div>;
  return <div className="flow-ai-fields">
    <p className="flow-ai-hint">{t('flow.aiHint')}</p>
    {(flow.accountability !== 'user' || !flow.run_as) && <p className="notice-banner">{t('automation.runAsHint')}</p>}
    {error && <p className="error-banner" role="alert">{error}</p>}
    <label className="field-label"><span>{t('flow.collection')}</span><select value={options.collection} onChange={event => { if (Object.keys(options.output_constraints ?? {}).length) { setError(t('automation.constraintFieldInUse')); return; } patch({ collection: event.target.value, input_fields: [], output_fields: [], output_constraints: {} }); }}>
      <option value="">{t('common.none')}</option>{configuration?.collections.map(item => <option value={item.collection} key={item.collection}>{item.name}</option>)}
    </select></label>
    <label className="field-label"><span>{t('flow.aiIds')}</span><input value={typeof options.ids === 'string' ? options.ids : JSON.stringify(options.ids)} onChange={event => patch({ ids: event.target.value })} /><small>{t('flow.jsonHint')}</small></label>
    {['input_fields', 'output_fields'].map(key => <fieldset className="flow-ai-checklist" key={key}><legend>{t(key === 'input_fields' ? 'automation.inputs' : 'automation.outputs')}</legend>
      {(collection?.fields ?? []).filter(field => key === 'input_fields' || field.output).map(field => <label className="checkbox-label" key={field.field}><input type="checkbox" checked={options[key]?.includes(field.field) ?? false} disabled={!options[key]?.includes(field.field) && options[key]?.length >= 10} onChange={() => toggle(key, field.field)} /><span>{field.name}<small>{field.field}</small></span></label>)}
    </fieldset>)}
    {!!options.output_fields?.length && <AutomationOutputConstraints fields={collection?.fields ?? []} draft={options} t={t} onChange={(output, input) => onChange(setAutomationConstraint(options, output, input))} />}
    <label className="field-label"><span>{t('automation.instruction')}</span><textarea value={options.instruction} rows={5} maxLength={8000} onChange={event => patch({ instruction: event.target.value })} /></label>
    <details className="flow-ai-preview"><summary>{t('automation.preview')}</summary><p>{t('automation.previewHint')}</p>
      <label className="field-label"><span>{t('automation.sample')}</span><input value={sample} maxLength={191} disabled={busy} onChange={event => { setSample(event.target.value); setPreview(null); }} /></label>
      <button type="button" className="secondary-button" disabled={busy || !sample || !status?.configured || !status?.enabled || !flow.run_as || !options.input_fields?.length || !options.output_fields?.length} onClick={testRecord}>{busy ? t('common.loading') : t('automation.preview')}</button>
      {preview && <div className="flow-ai-preview-result"><div><h3>{t('automation.before')}</h3><pre>{JSON.stringify(preview.before, null, 2)}</pre></div><div><h3>{t('automation.proposed')}</h3><pre>{JSON.stringify(preview.proposed, null, 2)}</pre></div></div>}
    </details>
  </div>;
}
