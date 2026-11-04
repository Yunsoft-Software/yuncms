export function ChoiceChecklist({ label, choices, value = [], onChange, disabled = false }) {
  return <fieldset className="choice-checklist" disabled={disabled}><legend>{label}</legend><div>{choices.map(choice => <label className="checkbox-label" key={choice.value}><input type="checkbox" checked={value.includes(choice.value)} onChange={event => onChange(event.currentTarget.checked ? [...value, choice.value] : value.filter(item => item !== choice.value))} /><span>{choice.label}</span></label>)}</div></fieldset>;
}
