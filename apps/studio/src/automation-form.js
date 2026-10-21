export function emptyAutomation() {
  return { name: '', collection: '', run_as: '', enabled: false, on_create: true, on_update: false,
    input_fields: [], output_fields: [], output_constraints: {}, instruction: '' };
}

export function editableAutomation(rule) {
  const defaults = emptyAutomation();
  return Object.fromEntries(Object.keys(defaults).map((key) => [key, structuredClone(rule[key] ?? defaults[key])]));
}

export function toggleAutomationField(draft, key, field) {
  const selected = draft[key].includes(field);
  const other = key === 'input_fields' ? 'output_fields' : 'input_fields';
  if ((selected || draft[other].includes(field)) && Object.entries(draft.output_constraints ?? {})
    .some(([output, binding]) => output === field || binding.must_equal_input === field)) {
    throw Object.assign(new Error('Remove the equality constraint before moving its field'), { code: 'AUTOMATION_CONSTRAINT_FIELD_IN_USE' });
  }
  return { ...draft, [key]: selected ? draft[key].filter((value) => value !== field) : [...draft[key], field],
    [other]: selected ? draft[other] : draft[other].filter((value) => value !== field) };
}

export function setAutomationConstraint(draft, output, input) {
  const entries = Object.entries(draft.output_constraints ?? {}).filter(([field]) => field !== output);
  if (input) entries.push([output, { must_equal_input: input }]);
  return { ...draft, output_constraints: Object.fromEntries(entries) };
}
