// SPDX-FileCopyrightText: 2026 Yunsoft Software
// SPDX-License-Identifier: LicenseRef-YunCMS-Commercial
import { useState } from 'react';
import { apiRequest } from '../api.js';
import { editHeaders } from '../content-edit-state.js';
import { Modal, useConfirmDialog } from '../components/index.js';
import { useI18n } from '../i18n.js';

export function ContentHistory({ collection, record, onRestored, disabled }) {
  const { t, locale } = useI18n(), confirmAction = useConfirmDialog();
  const [open, setOpen] = useState(false), [rows, setRows] = useState([]), [selected, setSelected] = useState(null);
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [offset, setOffset] = useState(0);
  const path = `/items/${encodeURIComponent(collection)}/${encodeURIComponent(record.id)}/revisions`;
  async function perform(task) {
    setBusy(true); setError('');
    try { await task(); } catch (failure) { setError(failure.code === 'ITEM_REVISION_CONFLICT' ? t('features.editConflict') : failure.message); }
    finally { setBusy(false); }
  }
  async function load(nextOffset = 0) {
    const result = await apiRequest(`${path}?limit=25&offset=${nextOffset}`);
    setRows(result.data); setOffset(nextOffset); setSelected(null);
  }
  async function restore() {
    if (!selected || !await confirmAction({ title: t('features.restore'), description: t('features.restoreHint') })) return;
    await perform(async () => {
      await apiRequest(`${path}/${selected.revision}/restore`, { method: 'POST', headers: editHeaders(record) });
      await onRestored(); await load(0);
    });
  }
  return <>
    <button className="secondary-button" type="button" disabled={disabled || busy} onClick={() => { setOpen(true); perform(() => load()); }}>{t('features.contentHistory')}</button>
    <Modal open={open} title={t('features.contentHistory')} description={t('features.historyHint')} onClose={() => { if (!busy) setOpen(false); }} actions={<>
      <button className="text-button" type="button" disabled={busy} onClick={() => setOpen(false)}>{t('common.close')}</button>
      {selected && <button className="primary-button" type="button" disabled={busy || disabled} onClick={restore}>{t('features.restore')}</button>}
    </>}>
      {error && <div className="error-banner" role="alert">{error}</div>}
      <div className="content-history-list" aria-busy={busy}>
        {!rows.length && <p className="muted-line">{t(busy ? 'common.loading' : 'features.noHistory')}</p>}
        {rows.map(row => <button className="secondary-button content-history-entry" type="button" key={row.revision} disabled={busy} aria-pressed={selected?.revision === row.revision} onClick={() => perform(async () => setSelected((await apiRequest(`${path}/${row.revision}`)).data))}>
          <strong>{t('features.revision', { revision: row.revision })}</strong><time dateTime={row.created_at}>{new Date(row.created_at).toLocaleString(locale)}</time>
        </button>)}
      </div>
      <div className="form-actions">
        <button className="text-button" type="button" disabled={busy || offset === 0} onClick={() => perform(() => load(Math.max(0, offset - 25)))}>{t('common.previous')}</button>
        <button className="text-button" type="button" disabled={busy || rows.length < 25} onClick={() => perform(() => load(offset + 25))}>{t('common.next')}</button>
      </div>
      {selected && <dl className="content-history-snapshot">{Object.entries(selected.snapshot ?? {}).map(([field, value]) => <div key={field}><dt>{field}</dt><dd><pre>{typeof value === 'object' ? JSON.stringify(value, null, 2) : String(value ?? '')}</pre></dd></div>)}</dl>}
    </Modal>
  </>;
}
