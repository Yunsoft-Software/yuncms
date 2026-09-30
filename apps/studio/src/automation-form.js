export function emptyAutomation() {
  return { name: '', collection: '', run_as: '', enabled: false, on_create: true, on_update: false,
    input_fields: [], output_fields: [], instruction: '' };
}

export function editableAutomation(rule) {
  return Object.fromEntries(Object.keys(emptyAutomation()).map((key) => [key, rule[key]]));
}

export function toggleAutomationField(draft, key, field) {
  const selected = draft[key].includes(field);
  const other = key === 'input_fields' ? 'output_fields' : 'input_fields';
  return { ...draft, [key]: selected ? draft[key].filter((value) => value !== field) : [...draft[key], field],
    [other]: selected ? draft[other] : draft[other].filter((value) => value !== field) };
}
