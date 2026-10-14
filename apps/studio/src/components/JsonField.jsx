import { useEffect, useId, useRef, useState } from 'react';

export function JsonField({ label, value, onChange, onValidityChange, disabled = false, rows = 7, hint = '', errorLabel = 'Enter valid JSON', objectOnly = false }) {
  const id = useId(), lastEmitted = useRef(JSON.stringify(value));
  const [text, setText] = useState(() => JSON.stringify(value, null, 2));
  const [invalid, setInvalid] = useState(false);
  useEffect(() => {
    const encoded = JSON.stringify(value);
    if (encoded !== lastEmitted.current) { lastEmitted.current = encoded; setText(JSON.stringify(value, null, 2)); setInvalid(false); }
  }, [value]);
  function edit(event) {
    const next = event.target.value; setText(next);
    try {
      const parsed = JSON.parse(next);
      if (objectOnly && (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))) throw Error('Object required');
      lastEmitted.current = JSON.stringify(parsed); setInvalid(false); onValidityChange?.(true); onChange(parsed);
    }
    catch { setInvalid(true); onValidityChange?.(false); }
  }
  return <label className="field-label json-field" htmlFor={id}><span>{label}</span>
    <textarea id={id} aria-label={label} className="json-field-input" value={text} disabled={disabled} rows={rows} spellCheck={false} onChange={edit} aria-invalid={invalid} aria-describedby={invalid ? `${id}-error` : hint ? `${id}-hint` : undefined} />
    {hint && <small id={`${id}-hint`}>{hint}</small>}{invalid && <small className="field-error" id={`${id}-error`} role="alert">{errorLabel}</small>}
  </label>;
}
