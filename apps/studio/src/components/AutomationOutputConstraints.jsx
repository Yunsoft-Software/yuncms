export function AutomationOutputConstraints({ fields, draft, onChange, t }) {
  const inputs = fields.filter(field => draft.input_fields.includes(field.field) && ['string', 'text'].includes(field.type));
  const hasJsonOutput = draft.output_fields.some(output => fields.find(field => field.field === output)?.type === 'json');
  return <fieldset className="automation-form-fields">
    <legend>{t('automation.constraints')}</legend>
    <small>{t('automation.constraintsHint')}</small>
    {draft.output_fields.map(output => {
      const field = fields.find(entry => entry.field === output);
      const bound = draft.output_constraints?.[output]?.must_equal_input ?? '';
      const canBind = ['string', 'text'].includes(field?.type) && !hasJsonOutput;
      return <label key={output} className="field-label"><span>{t('automation.mustEqualInput', { field: field?.name ?? output })}</span>
        <select value={bound} disabled={!canBind && !bound} onChange={event => onChange(output, event.target.value)}>
          <option value="">{t('automation.noConstraint')}</option>
          {bound && (!canBind || !inputs.some(input => input.field === bound)) && <option value={bound} disabled>{bound}</option>}
          {canBind && inputs.map(input => <option key={input.field} value={input.field}>{input.name} · {input.field}</option>)}
        </select>
      </label>;
    })}
  </fieldset>;
}
