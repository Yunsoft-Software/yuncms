import { useEffect, useState } from 'react';
import { apiRequest } from '../api.js';
import { useI18n } from '../i18n.js';
import { JsonField } from './JsonField.jsx';
import { Modal } from './Modal.jsx';

export function ManualFlowActions({ collection, keys = [], onComplete }) {
  const { t } = useI18n();
  const [flows, setFlows] = useState([]), [selected, setSelected] = useState(null);
  const [body, setBody] = useState({}), [invalid, setInvalid] = useState(false), [busy, setBusy] = useState(false);
  const [error, setError] = useState(''), [notice, setNotice] = useState('');
  useEffect(() => {
    let active = true; setFlows([]); setError(''); setNotice('');
    if (collection) apiRequest(`/flows/available?collection=${encodeURIComponent(collection)}`).then(response => { if (active) setFlows(response.data); }).catch(() => {});
    return () => { active = false; };
  }, [collection]);
  async function execute(flow, payload = body) {
    setBusy(true); setError(''); setNotice('');
    try {
      await apiRequest(`/flows/${encodeURIComponent(flow.id)}/run`, { method: 'POST', body: { collection, keys, body: payload } });
      setSelected(null); setNotice(t('flow.completed')); await onComplete?.();
    } catch (failure) { setError(failure.message); }
    finally { setBusy(false); }
  }
  if (!flows.length) return null;
  return <section className="manual-flow-actions" aria-label={t('flow.title')}>
    <div className="flow-toolbar-actions">{flows.map(flow => <button key={flow.id} type="button" className="secondary-button" disabled={busy || (flow.require_selection && !keys.length)} onClick={() => {
      if (flow.require_confirmation) { setBody({}); setInvalid(false); setSelected(flow); } else execute(flow, {});
    }}>{flow.name}</button>)}</div>
    {error && <div className="error-banner" role="alert">{error}</div>}{notice && <p role="status">{notice}</p>}
    <Modal open={Boolean(selected)} title={selected?.name} description={selected?.confirmation || t('flow.runHint')} onClose={() => { if (!busy) setSelected(null); }} actions={<><button type="button" className="text-button" disabled={busy} onClick={() => setSelected(null)}>{t('common.cancel')}</button><button type="button" className="primary-button" disabled={busy || invalid} onClick={() => execute(selected)}>{t('flow.run')}</button></>}>
      <JsonField objectOnly label={t('flow.confirmationData')} value={body} onChange={setBody} onValidityChange={valid => setInvalid(!valid)} errorLabel={t('flow.invalidJson')} />
    </Modal>
  </section>;
}
