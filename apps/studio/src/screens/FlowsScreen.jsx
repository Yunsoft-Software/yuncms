import { useEffect, useState } from 'react';
import { apiRequest } from '../api.js';
import { addFlowOperation, exportFlowDefinition, importFlowDefinition, newFlowDraft, removeFlowOperation } from '../flow-graph.js';
import { useI18n } from '../i18n.js';
import { navigateStudio, studioPath } from '../studio-route.js';
import { parseJsonImportText } from '../json-import.js';
import { useConfirmDialog, FlowCanvas, FlowInspector, FlowList, FlowRunHistory, JsonField, JsonImportField, Modal } from '../components/index.js';

export function FlowsScreen({ route }) {
  const [listState, setListState] = useState({ page: 1, pageSize: 10, search: '', status: '', trigger: '' });
  const [initialDraft, setInitialDraft] = useState(null), [launchImport, setLaunchImport] = useState(false), [draftKey, setDraftKey] = useState(0);
  const create = (draft = null, importing = false) => { setInitialDraft(draft); setLaunchImport(importing); setDraftKey(value => value + 1); navigateStudio(studioPath.newFlow()); };
  if (route.view === 'list') return <FlowList state={listState} onStateChange={setListState} onNew={() => create()} onImport={() => create(null, true)} />;
  return <FlowEditor key={route.flowId || `new-${draftKey}`} route={route} initialDraft={initialDraft} launchImport={launchImport}
    onLaunchHandled={() => { setInitialDraft(null); setLaunchImport(false); }} onCreateDraft={create} />;
}

function FlowEditor({ route, initialDraft, launchImport, onLaunchHandled, onCreateDraft }) {
  const { t } = useI18n(), confirmAction = useConfirmDialog();
  const [configuration, setConfiguration] = useState(null), [ready, setReady] = useState(false), [access, setAccess] = useState({ manage: false, run: false });
  const [draft, setDraft] = useState(() => initialDraft ?? newFlowDraft()), [selected, setSelected] = useState('trigger');
  const [run, setRun] = useState(null), [historyOpen, setHistoryOpen] = useState(false), [historyRefresh, setHistoryRefresh] = useState(0);
  const [inspectorOpen, setInspectorOpen] = useState(true);
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [invalid, setInvalid] = useState(false);
  const [saved, setSaved] = useState(false), [baseline, setBaseline] = useState('');
  const [importOpen, setImportOpen] = useState(launchImport), [importText, setImportText] = useState('');
  const [importError, setImportError] = useState(''), [importReading, setImportReading] = useState(false);
  const [runOpen, setRunOpen] = useState(false), [runPayload, setRunPayload] = useState({ body: { name: 'YunCMS' } });
  const [runInvalid, setRunInvalid] = useState(false), [paletteType, setPaletteType] = useState('transform');
  const dirty = baseline !== JSON.stringify(draft);
  useEffect(() => {
    let active = true;
    onLaunchHandled();
    Promise.all([apiRequest('/flows/configuration'), route.flowId ? apiRequest(`/flows/${encodeURIComponent(route.flowId)}`) : Promise.resolve({ data: initialDraft ?? newFlowDraft(), meta: { access: { manage: true, run: false } } })]).then(([config, result]) => {
      if (!active) return;
      if (!route.flowId && !config.data.access.manage) throw Object.assign(new Error(t('flow.accessDenied')), { code: 'FORBIDDEN' });
      setAccess(result.meta.access); setConfiguration(config.data); setDraft(result.data); setBaseline(JSON.stringify(result.data)); setReady(true);
    }).catch(failure => { if (active) setError(failure.message); });
    return () => { active = false; };
  }, [route.flowId]);
  function change(next) { setDraft(next); setSaved(false); setRun(null); }
  async function perform(operation) {
    setBusy(true); setError('');
    try { await operation(); } catch (requestError) { setError(requestError.message); } finally { setBusy(false); }
  }
  async function navigate(path) {
    if (dirty && !await confirmAction({ title: t('flow.unsaved'), description: t('flow.discardHint') })) return;
    if (path === studioPath.newFlow()) onCreateDraft(newFlowDraft());
    else navigateStudio(path);
  }
  async function save() {
    if (invalid) return;
    await perform(async () => {
      const result = await apiRequest(draft.id ? `/flows/${encodeURIComponent(draft.id)}` : '/flows', { method: draft.id ? 'PUT' : 'POST', body: draft });
      const next = result.data; setDraft(next); setBaseline(JSON.stringify(next)); setSaved(true); setAccess({ manage: true, run: true });
      navigateStudio(studioPath.flow(next.id));
    });
  }
  async function remove() {
    if (!await confirmAction({ title: t('common.delete'), description: t('flow.deleteHint'), tone: 'danger' })) return;
    await perform(async () => {
      await apiRequest(`/flows/${encodeURIComponent(draft.id)}?revision=${draft.revision}`, { method: 'DELETE' });
      navigateStudio(studioPath.flows());
    });
  }
  function addOperation() {
    try { const next = addFlowOperation(draft, paletteType); change(next); setSelected(next.operations.at(-1).id); setInvalid(false); }
    catch (failure) { setError(failure.message); }
  }
  async function exportDefinition() {
    let portable;
    try { portable = draft.id && !dirty ? await apiRequest(`/flows/${encodeURIComponent(draft.id)}/export`) : exportFlowDefinition(draft); } catch (failure) { setError(failure.message); return; }
    const url = URL.createObjectURL(new Blob([JSON.stringify(portable, null, 2)], { type: 'application/json' }));
    const anchor = document.createElement('a'); anchor.href = url; anchor.download = `${(draft.name || 'flow').replace(/[^A-Za-z0-9_-]+/g, '-')}.json`; anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  function importFailure(failure) {
    setImportError(t(failure.code === 'JSON_IMPORT_TOO_LARGE' ? 'flow.importTooLarge' : failure.code === 'JSON_IMPORT_INVALID' ? 'flow.importInvalidJson' : 'flow.importInvalid'));
  }
  function adoptDraft(next) {
    if (route.flowId) onCreateDraft(next);
    else { change(next); setSelected('trigger'); setInvalid(false); }
  }
  async function runSaved() {
    await perform(async () => {
      try { await apiRequest(`/flows/${encodeURIComponent(draft.id)}/run`, { method: 'POST', body: runPayload }); }
      finally { setRunOpen(false); setHistoryRefresh(value => value + 1); setHistoryOpen(true); }
    });
  }
  if (!configuration || !ready) return <section className="flows-workspace">{error ? <div className="error-banner" role="alert">{error}</div> : <p role="status">{t('common.loading')}</p>}</section>;
  return <section className="flows-workspace" aria-label={t('flow.title')}>
    <header className="flow-heading"><div><button type="button" className="text-button flow-back" disabled={busy} onClick={() => navigate(studioPath.flows())}>← {t('flow.back')}</button><h1>{draft.name || t('flow.new')}</h1><p>{t('flow.subtitle')}</p></div>
      <div className="flow-toolbar-actions">{access.manage && <><button className="secondary-button" type="button" disabled={busy} onClick={() => navigate(studioPath.newFlow())}>{t('flow.new')}</button>
        <button className="secondary-button" type="button" disabled={busy} onClick={() => { setImportText(''); setImportError(''); setImportReading(false); setImportOpen(true); }}>{t('flow.import')}</button></>}
        <button className="secondary-button" type="button" disabled={busy || !draft.id} onClick={() => setHistoryOpen(true)}>{t('flow.runs')}</button>
        {access.manage && <button className="primary-button" type="button" disabled={busy || invalid || !draft.name.trim()} onClick={save}>{busy ? t('common.saving') : t('common.save')}</button>}</div>
    </header>
    {!access.manage && <p className="notice-banner">{t('flow.readOnly')}</p>}
    {error && <div className="error-banner" role="alert">{error}</div>}{saved && <p className="success-banner" role="status">{t('common.saved')}</p>}
    <div className={`flow-layout ${inspectorOpen ? '' : 'flow-layout-expanded'}`}>
      <div className="flow-workbench"><div className="flow-palette">{access.manage && <><label className="field-label"><span>{t('flow.operations')}</span><select aria-label={t('flow.operations')} value={paletteType} disabled={busy} onChange={event => setPaletteType(event.target.value)}>
        {configuration.operations.map(type => <option value={type} key={type}>{t(`flow.operation.${type}`)}</option>)}</select></label>
        <button type="button" className="secondary-button" disabled={busy || draft.operations.length >= 100} onClick={addOperation}>{t('flow.addOperation')}</button></>}
        <button type="button" className="secondary-button" aria-expanded={inspectorOpen} onClick={() => setInspectorOpen(value => !value)}>{t(inspectorOpen ? 'flow.hideSettings' : 'flow.showSettings')}</button>
        <span className="flow-draft-status">{dirty ? t('flow.unsaved') : ''}</span></div>
        <p className="flow-canvas-hint">{t('flow.connectionsHint')}</p>
        <FlowCanvas flow={draft} selected={selected} disabled={busy || !access.manage} onSelect={id => { setSelected(id); setInvalid(false); setInspectorOpen(true); }} onChange={change} onError={failure => setError(failure.message)} trace={run?.trace ?? []} />
        <div className="flow-workbench-actions"><button type="button" className="secondary-button" disabled={busy || !access.run || dirty || !draft.id || draft.status !== 'active' || draft.trigger !== 'manual'} title={t(access.run ? 'flow.saveFirst' : 'flow.runDenied')} onClick={() => { setRunInvalid(false); setRunOpen(true); }}>{t('flow.run')}</button>
          <button type="button" className="secondary-button" disabled={busy || !draft.name} onClick={exportDefinition}>{t('flow.export')}</button>
          {draft.id && access.manage && <><button type="button" className="secondary-button" disabled={busy} onClick={() => { const next = { ...importFlowDefinition(draft), name: `${draft.name} (${t('flow.copySuffix')})` }; adoptDraft(next); }}>{t('flow.duplicate')}</button>
            <button type="button" className="danger-button" disabled={busy} onClick={remove}>{t('common.delete')}</button></>}
        </div>
      </div>
      {inspectorOpen && <FlowInspector key={selected} flow={draft} selected={selected} configuration={configuration} onChange={change} disabled={busy || !access.manage} onValidityChange={valid => setInvalid(!valid)} onRemove={id => { change(removeFlowOperation(draft, id)); setSelected('trigger'); setInvalid(false); }} />}
    </div>
    {draft.id && <FlowRunHistory flowId={draft.id} open={historyOpen} onClose={() => setHistoryOpen(false)} onSelect={setRun} refreshKey={historyRefresh} />}
    <Modal open={importOpen && access.manage} title={t('flow.import')} description={t('flow.importHint')} onClose={() => setImportOpen(false)} actions={<><button type="button" className="text-button" onClick={() => setImportOpen(false)}>{t('common.cancel')}</button><button type="button" className="primary-button" disabled={importReading || Boolean(importError)} onClick={async () => {
      setImportReading(true);
      try { const parsed = importFlowDefinition(parseJsonImportText(importText)); const result = await apiRequest('/flows/import?preview=1', { method: 'POST', body: parsed }); adoptDraft(result.data); setImportOpen(false); }
      catch (failure) { importFailure(failure); }
      finally { setImportReading(false); }
    }}>{t('flow.import')}</button></>}>
      <JsonImportField value={importText} onChange={value => { setImportText(value); setImportError(''); }} onError={importFailure} onLoadingChange={setImportReading}
        fileLabel={t('flow.importFile')} textLabel={t('flow.importJson')} loadingLabel={t('common.loading')} />
      {importError && <div className="error-banner" role="alert">{importError}</div>}
    </Modal>
    <Modal open={runOpen} title={t('flow.run')} description={t('flow.runHint')} onClose={() => setRunOpen(false)} actions={<><button type="button" className="text-button" disabled={busy} onClick={() => setRunOpen(false)}>{t('common.cancel')}</button><button type="button" className="primary-button" disabled={busy || runInvalid} onClick={runSaved}>{t('flow.run')}</button></>}>
      <JsonField objectOnly label={t('flow.runPayload')} value={runPayload} onChange={setRunPayload} onValidityChange={valid => setRunInvalid(!valid)} errorLabel={t('flow.invalidJson')} />
    </Modal>
  </section>;
}
