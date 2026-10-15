import { useEffect, useRef, useState } from 'react';
import { readJsonImportFile } from '../json-import.js';

export function JsonImportField({ value, onChange, onError, onLoadingChange, fileLabel, textLabel, loadingLabel, disabled = false }) {
  const version = useRef(0), [loading, setLoading] = useState(false);
  useEffect(() => () => { version.current++; }, []);
  function pending(next) { setLoading(next); onLoadingChange?.(next); }
  async function load(event) {
    const file = event.currentTarget.files?.[0]; event.currentTarget.value = '';
    if (!file) return;
    const request = ++version.current; pending(true);
    try {
      const text = await readJsonImportFile(file);
      if (request === version.current) onChange(text);
    } catch (error) { if (request === version.current) onError(error); }
    finally { if (request === version.current) pending(false); }
  }
  return <div className="form-stack">
    <label className="field-label"><span>{fileLabel}</span><input type="file" accept=".json,application/json" disabled={disabled || loading} onChange={load} /></label>
    {loading && <small role="status">{loadingLabel}</small>}
    <label className="field-label"><span>{textLabel}</span><textarea className="json-field-input" rows={12} value={value} disabled={disabled}
      onChange={event => { version.current++; pending(false); onChange(event.currentTarget.value); }} /></label>
  </div>;
}
