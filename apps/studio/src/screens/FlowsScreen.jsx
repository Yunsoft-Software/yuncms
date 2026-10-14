import { useEffect, useRef, useState } from 'react';
import { apiRequest } from '../api.js';
import { addFlowOperation, exportFlowDefinition, importFlowDefinition, newFlowDraft, removeFlowOperation } from '../flow-graph.js';
import { useI18n } from '../i18n.js';
import { navigateStudio, studioPath } from '../studio-route.js';
import { useConfirmDialog, FlowCanvas, FlowInspector, FlowRunHistory, JsonField, Modal } from '../components/index.js';

export function FlowsScreen({ route }) {
  const { t } = useI18n(), confirmAction = useConfirmDialog();
  const [flows, setFlows] = useState([]), [configuration, setConfiguration] = useState(null);
  const [draft, setDraft] = useState(newFlowDraft), [selected, setSelected] = useState('trigger');
  const [runs, setRuns] = useState([]), [run, setRun] = useState(null), [search, setSearch] = useState('');
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [invalid, setInvalid] = useState(false);
  const [saved, setSaved] = useState(false), [baseline, setBaseline] = useState('');
  const [importOpen, setImportOpen] = useState(false), [importText, setImportText] = useState('');
  const [runOpen, setRunOpen] = useState(false), [runPayload, setRunPayload] = useState({ body: { name: 'YunCMS' } });
  const [runInvalid, setRunInvalid] = useState(false), [paletteType, setPaletteType] = useState('transform');
  const loadedRoute = useRef(null);
  const dirty = baseline !== JSON.stringify(draft);
  useEffect(() => {
    let active = true;
    Promise.all([apiRequest('/flows'), apiRequest('/flows/configuration')]).then(([list, config]) => {
      if (active) { setFlows(list.data); setConfiguration(config.data); }
    }).catch(requestError => { if (active) setError(requestError.message); });
    return () => { active = false; };
  }, []);
  useEffect(() => {
    if (!configuration) return;
    const key = route.flowId || route.view || 'list';
    if (loadedRoute.current === key) return;
    const current = route.flowId ? flows.find(flow => flow.id === route.flowId) : null;
    if (route.flowId && !current) { setError('Flow not found'); return; }
    const next = current ? structuredClone(current) : newFlowDraft();
    loadedRoute.current = key; setDraft(next); setBaseline(JSON.stringify(next)); setSelected('trigger'); setInvalid(false); setSaved(false); setError(''); setRun(null);
  }, [route.flowId, route.view, flows, configuration]);
  useEffect(() => {
    let active = true; setRuns([]); setRun(null);
    if (draft.id) apiRequest(`/flows/${encodeURIComponent(draft.id)}/runs`).then(result => { if (active) setRuns(result.data); }).catch(requestError => { if (active) setError(requestError.message); });
    return () => { active = false; };
  }, [draft.id]);
  function change(next) { setDraft(next); setSaved(false); setRun(null); }
  async function perform(operation) {
    setBusy(true); setError('');
    try { await operation(); } catch (requestError) { setError(requestError.message); } finally { setBusy(false); }
  }
  async function navigate(path) {
    if (dirty && !await confirmAction({ title: t('flow.unsaved'), description: t('flow.discardHint') })) return;
    loadedRoute.current = null; navigateStudio(path);
  }
  async function save() {
    if (invalid) return;
    await perform(async () => {
      const result = await apiRequest(draft.id ? `/flows/${encodeURIComponent(draft.id)}` : '/flows', { method: draft.id ? 'PUT' : 'POST', body: draft });
      const next = result.data; setDraft(next); setBaseline(JSON.stringify(next)); setSaved(true);
      setFlows(current => [...current.filter(flow => flow.id !== next.id), next]);
      loadedRoute.current = next.id; navigateStudio(studioPath.flow(next.id));
    });
  }
  async function remove() {
    if (!await confirmAction({ title: t('common.delete'), description: t('flow.deleteHint'), tone: 'danger' })) return;
    await perform(async () => {
      await apiRequest(`/flows/${encodeURIComponent(draft.id)}?revision=${draft.revision}`, { method: 'DELETE' });
      setFlows(current => current.filter(flow => flow.id !== draft.id)); loadedRoute.current = null; navigateStudio(studioPath.newFlow());
    });
  }
  function addOperation() {
    try { const next = addFlowOperation(draft, paletteType); change(next); setSelected(next.operations.at(-1).id); setInvalid(false); }
    catch (failure) { setError(failure.message); }
  }
  function exportDefinition() {
    const url = URL.createObjectURL(new Blob([JSON.stringify(exportFlowDefinition(draft), null, 2)], { type: 'application/json' }));
    const anchor = document.createElement('a'); anchor.href = url; anchor.download = `${(draft.name || 'flow').replace(/[^A-Za-z0-9_-]+/g, '-')}.json`; anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  async function runSaved() {
    await perform(async () => {
      try { await apiRequest(`/flows/${encodeURIComponent(draft.id)}/run`, { method: 'POST', body: runPayload }); }
      finally {
        const result = await apiRequest(`/flows/${encodeURIComponent(draft.id)}/runs`); setRuns(result.data); setRun(result.data[0] ?? null); setRunOpen(false);
      }
    });
  }
  if (!configuration) return <section className="flows-workspace">{error ? <div className="error-banner" role="alert">{error}</div> : <p role="status">{t('common.loading')}</p>}</section>;
  return <section className="flows-workspace" aria-label={t('flow.title')}>
    <header className="flow-heading"><div><h1>{draft.name || t('flow.title')}</h1><p>{t('flow.subtitle')}</p></div>
      <div className="flow-toolbar-actions"><button className="secondary-button" type="button" disabled={busy} onClick={() => navigate(studioPath.newFlow())}>{t('flow.new')}</button>
        <button className="secondary-button" type="button" disabled={busy} onClick={() => { setImportText(''); setImportOpen(true); }}>{t('flow.import')}</button>
        <button className="primary-button" type="button" disabled={busy || invalid || !draft.name.trim()} onClick={save}>{busy ? t('common.saving') : t('common.save')}</button></div>
    </header>
    {error && <div className="error-banner" role="alert">{error}</div>}{saved && <p className="success-banner" role="status">{t('common.saved')}</p>}
    <div className="flow-layout">
      <aside className="flow-list" aria-label={t('flow.title')}><input type="search" aria-label={t('flow.search')} placeholder={t('flow.search')} value={search} onChange={event => setSearch(event.target.value)} />
        {!flows.length && <p>{t('flow.empty')}</p>}{flows.filter(flow => flow.name.toLocaleLowerCase().includes(search.toLocaleLowerCase())).map(flow => <button type="button" disabled={busy} key={flow.id} className={draft.id === flow.id ? 'active' : ''} onClick={() => navigate(studioPath.flow(flow.id))}>
          <strong>{flow.name}</strong><small>{t(`flow.trigger.${flow.trigger}`)} · {t(`flow.${flow.status}`)}</small></button>)}
      </aside>
      <div className="flow-workbench"><div className="flow-palette"><label className="field-label"><span>{t('flow.operations')}</span><select aria-label={t('flow.operations')} value={paletteType} disabled={busy} onChange={event => setPaletteType(event.target.value)}>
        {configuration.operations.map(type => <option value={type} key={type}>{t(`flow.operation.${type}`)}</option>)}</select></label>
        <button type="button" className="secondary-button" disabled={busy || draft.operations.length >= 100} onClick={addOperation}>{t('flow.addOperation')}</button>
        <span className="flow-draft-status">{dirty ? t('flow.unsaved') : ''}</span></div>
        <p className="flow-canvas-hint">{t('flow.connectionsHint')}</p>
        <FlowCanvas flow={draft} selected={selected} disabled={busy} onSelect={id => { setSelected(id); setInvalid(false); }} onChange={change} onError={failure => setError(failure.message)} trace={run?.trace ?? []} />
        <div className="flow-workbench-actions"><button type="button" className="secondary-button" disabled={busy || dirty || !draft.id || draft.status !== 'active' || draft.trigger !== 'manual'} title={t('flow.saveFirst')} onClick={() => { setRunInvalid(false); setRunOpen(true); }}>{t('flow.run')}</button>
          <button type="button" className="secondary-button" disabled={busy || !draft.name} onClick={exportDefinition}>{t('flow.export')}</button>
          {draft.id && <><button type="button" className="secondary-button" disabled={busy} onClick={() => { const next = { ...importFlowDefinition(draft), name: `${draft.name} (${t('flow.copySuffix')})` }; change(next); setSelected('trigger'); setInvalid(false); }}>{t('flow.duplicate')}</button>
            <button type="button" className="danger-button" disabled={busy} onClick={remove}>{t('common.delete')}</button></>}
        </div>
      </div>
      <FlowInspector key={selected} flow={draft} selected={selected} configuration={configuration} onChange={change} disabled={busy} onValidityChange={valid => setInvalid(!valid)} onRemove={id => { change(removeFlowOperation(draft, id)); setSelected('trigger'); setInvalid(false); }} />
    </div>
    {draft.id && <FlowRunHistory runs={runs} selected={run} onSelect={setRun} />}
    <Modal open={importOpen} title={t('flow.import')} description={t('flow.importHint')} onClose={() => setImportOpen(false)} actions={<><button type="button" className="text-button" onClick={() => setImportOpen(false)}>{t('common.cancel')}</button><button type="button" className="primary-button" onClick={() => {
      try { const next = importFlowDefinition(JSON.parse(importText)); change(next); setSelected('trigger'); setInvalid(false); setImportOpen(false); }
      catch (failure) { setError(failure.message); }
    }}>{t('flow.import')}</button></>}>
      <label className="field-label"><span>{t('flow.importJson')}</span><textarea className="json-field-input" rows={12} value={importText} onChange={event => setImportText(event.target.value)} /></label>
    </Modal>
    <Modal open={runOpen} title={t('flow.run')} description={t('flow.runHint')} onClose={() => setRunOpen(false)} actions={<><button type="button" className="text-button" disabled={busy} onClick={() => setRunOpen(false)}>{t('common.cancel')}</button><button type="button" className="primary-button" disabled={busy || runInvalid} onClick={runSaved}>{t('flow.run')}</button></>}>
      <JsonField objectOnly label={t('flow.runPayload')} value={runPayload} onChange={setRunPayload} onValidityChange={valid => setRunInvalid(!valid)} errorLabel={t('flow.invalidJson')} />
    </Modal>
  </section>;
}
