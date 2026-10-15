import { useId } from 'react';

export function CodeField({ label, value, onChange, hint, disabled = false }) {
  const id = useId();
  return <label className="field-label json-field" htmlFor={id}><span>{label}</span>
    <textarea id={id} aria-label={label} className="json-field-input" rows={16} spellCheck={false} autoCapitalize="off" autoCorrect="off" disabled={disabled} value={value} onChange={event => onChange(event.target.value)} aria-describedby={hint ? `${id}-hint` : undefined} />
    {hint && <small id={`${id}-hint`}>{hint}</small>}
  </label>;
}
