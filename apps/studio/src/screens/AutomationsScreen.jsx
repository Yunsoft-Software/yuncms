import { useEffect, useState } from 'react';
import { apiRequest, aiStatus } from '../api.js';
import { editableAutomation, emptyAutomation, toggleAutomationField } from '../automation-form.js';
import { useConfirmDialog, YunsoftSupportCard } from '../components/index.js';
import { useI18n } from '../i18n.js';

function FieldChecklist({ label, fields, selected, onToggle, disabled }) {
  return <fieldset className="automation-fields" disabled={disabled}><legend>{label}</legend>
    {fields.map((field) => <label key={field.field}><input type="checkbox" checked={selected.includes(field.field)}
      onChange={() => onToggle(field.field)} disabled={!selected.includes(field.field) && selected.length >= 10} />
    <span>{field.name} <small>{field.field}</small></span></label>)}
  </fieldset>;
}

export function AutomationsScreen() {
  const { t } = useI18n();
  const confirmAction = useConfirmDialog();
  const [rules, setRules] = useState([]);
  const [configuration, setConfiguration] = useState({ users: [], collections: [] });
  const [status, setStatus] = useState(null);
  const [draft, setDraft] = useState(emptyAutomation);
  const [id, setId] = useState(null);
  const [runs, setRuns] = useState([]);
  const [sample, setSample] = useState('');
  const [preview, setPreview] = useState(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  const collection = configuration.collections.find((entry) => entry.collection === draft.collection);
  const selectedRule = rules.find((entry) => entry.id === id);
  const ready = status?.configured && status?.enabled && status?.writes_available;

  useEffect(() => {
    let cancelled = false;
    Promise.all([apiRequest('/automations'), apiRequest('/automations/configuration'), aiStatus()])
      .then(([list, config, ai]) => { if (!cancelled) { setRules(list.data); setConfiguration(config.data); setStatus(ai); } })
      .catch((requestError) => { if (!cancelled) setError(requestError.message); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    let cancelled = false;
    setRuns([]);
    if (!id) return undefined;
    const load = () => apiRequest(`/automations/${encodeURIComponent(id)}/runs`)
      .then((result) => { if (!cancelled) setRuns(result.data); })
      .catch((requestError) => { if (!cancelled) setError(requestError.message); });
    load();
    const timer = setInterval(load, 5000);
    return () => { cancelled = true; clearInterval(timer); };
  }, [id]);

  function patch(values) { setDraft((current) => ({ ...current, ...values })); setPreview(null); setSaved(false); }
  function choose(rule = null) {
    setId(rule?.id ?? null); setDraft(rule ? editableAutomation(rule) : emptyAutomation());
    setPreview(null); setSample(''); setError(''); setSaved(false);
  }
  async function perform(operation) {
    setBusy(true); setError(''); setSaved(false);
    try { await operation(); } catch (requestError) { setError(requestError.message); } finally { setBusy(false); }
  }
  async function save(event) {
    event.preventDefault();
    await perform(async () => {
      const result = await apiRequest(id ? `/automations/${encodeURIComponent(id)}` : '/automations', { method: id ? 'PUT' : 'POST', body: draft });
      setId(result.data.id); setDraft(editableAutomation(result.data));
      setRules((await apiRequest('/automations')).data); setSaved(true);
    });
  }
  async function remove() {
    if (!await confirmAction({ title: t('common.delete'), description: t('automation.deleteHint'), tone: 'danger' })) return;
    await perform(async () => {
      await apiRequest(`/automations/${encodeURIComponent(id)}`, { method: 'DELETE' });
      setRules((await apiRequest('/automations')).data); choose();
    });
  }

  if (loading) return <p role="status">{t('common.loading')}</p>;
  return <section className="automations-workspace" aria-label={t('automation.title')}>
    <header className="automation-heading"><div><h1>{t('automation.title')}</h1><p>{t('automation.subtitle')}</p></div>
      <button type="button" className="secondary-button" disabled={busy} onClick={() => choose()}>{t('automation.new')}</button></header>
    {error && <div className="error-banner" role="alert">{error}</div>}
    {!ready && <div className="automation-notice">{t('automation.providerHint')} <a href="#/ai">{t('ai.settings')}</a></div>}
    {!configuration.users.length && <div className="automation-notice">{t('automation.userHint')} <a href="#/users">{t('nav.users')}</a></div>}
    <div className="automation-layout">
      <aside className="automation-list" aria-label={t('automation.title')}>
        {!rules.length && <p>{t('automation.empty')}</p>}
        {rules.map((rule) => <button type="button" className={id === rule.id ? 'active' : ''} key={rule.id} disabled={busy} onClick={() => choose(rule)}>
          <strong>{rule.name}</strong><small>{rule.collection} · {rule.enabled ? t('automation.enabled') : t('automation.disabled')}</small>
        </button>)}
      </aside>
      <div className="automation-editor">
        <form onSubmit={save}>
          <fieldset disabled={busy} className="automation-form-fields">
            <div className="automation-grid">
              <label className="field-label"><span>{t('common.name')}</span><input required maxLength={120} value={draft.name} onChange={(event) => patch({ name: event.target.value })} /></label>
              <label className="field-label"><span>{t('automation.collection')}</span><select required value={draft.collection}
                onChange={(event) => patch({ collection: event.target.value, input_fields: [], output_fields: [] })}><option value="">{t('common.none')}</option>
                {configuration.collections.map((entry) => <option key={entry.collection} value={entry.collection}>{entry.name}</option>)}</select></label>
            </div>
            <label className="field-label"><span>{t('automation.runAs')}</span><select required value={draft.run_as} onChange={(event) => patch({ run_as: event.target.value })}>
              <option value="">{t('common.none')}</option>{configuration.users.map((user) => <option key={user.id} value={user.id}>{user.email} · {user.role}</option>)}</select><small>{t('automation.runAsHint')}</small></label>
            <div className="automation-triggers">
              {['on_create', 'on_update', 'enabled'].map((key) => <label key={key}><input type="checkbox" checked={draft[key]} onChange={(event) => patch({ [key]: event.target.checked })} />{t(`automation.${key}`)}</label>)}
            </div>
            <div className="automation-grid">
              <FieldChecklist label={t('automation.inputs')} fields={collection?.fields ?? []} selected={draft.input_fields} disabled={!collection}
                onToggle={(field) => { setDraft((current) => toggleAutomationField(current, 'input_fields', field)); setPreview(null); setSaved(false); }} />
              <FieldChecklist label={t('automation.outputs')} fields={(collection?.fields ?? []).filter((field) => field.output)} selected={draft.output_fields} disabled={!collection}
                onToggle={(field) => { setDraft((current) => toggleAutomationField(current, 'output_fields', field)); setPreview(null); setSaved(false); }} />
            </div>
            <label className="field-label"><span>{t('automation.instruction')}</span><textarea required rows={5} maxLength={8000} value={draft.instruction} placeholder={t('automation.example')}
              onChange={(event) => patch({ instruction: event.target.value })} /></label>
            <div className="automation-actions"><button className="primary-button" type="submit" disabled={!configuration.users.length}>{busy ? t('common.saving') : t('common.save')}</button>
              {id && <button className="danger-button" type="button" onClick={remove}>{t('common.delete')}</button>}
              {saved && <span role="status">{t('common.saved')}</span>}</div>
          </fieldset>
        </form>
        <section className="automation-preview"><h2>{t('automation.preview')}</h2><p>{t('automation.previewHint')}</p>
          <div className="automation-actions"><label className="field-label"><span>{t('automation.sample')}</span><input value={sample} maxLength={191} disabled={busy} onChange={(event) => { setSample(event.target.value); setPreview(null); }} /></label>
            <button type="button" className="secondary-button" disabled={busy || !sample || !status?.configured || !status?.enabled || !draft.input_fields.length || !draft.output_fields.length}
              onClick={() => perform(async () => setPreview((await apiRequest('/automations/preview', { method: 'POST', body: { rule: draft, item_key: sample } })).data))}>{t('automation.preview')}</button></div>
          {preview && <div className="automation-grid"><div><h3>{t('automation.before')}</h3><pre>{JSON.stringify(preview.before, null, 2)}</pre></div>
            <div><h3>{t('automation.proposed')}</h3><pre>{JSON.stringify(preview.proposed, null, 2)}</pre></div></div>}
        </section>
        {id && <section className="automation-runs"><h2>{t('automation.runs')}</h2>
          {!runs.length && <p>{t('automation.noRuns')}</p>}
          {runs.map((run) => <div className="automation-run" key={run.id}><div><strong>{run.item_key}</strong><small>{new Date(run.created_at).toLocaleString()}</small></div>
            <span>{t(`automation.status.${run.status}`)} · {run.attempts}/3</span>{run.error_code && <code>{run.error_code}</code>}
            {run.status === 'failed' && selectedRule?.enabled && run.revision === selectedRule.revision && <button type="button" className="secondary-button" disabled={busy}
              onClick={() => perform(async () => { await apiRequest(`/automations/runs/${encodeURIComponent(run.id)}/retry`, { method: 'POST' }); setRuns((await apiRequest(`/automations/${encodeURIComponent(id)}/runs`)).data); })}>{t('automation.retry')}</button>}
          </div>)}
        </section>}
      </div>
    </div>
    <YunsoftSupportCard />
  </section>;
}
