function scalar(value) {
  return value === null || typeof value === 'string' || typeof value === 'boolean'
    || (typeof value === 'number' && Number.isFinite(value));
}

// Describe only declared choices, never arbitrary interface configuration or
// guessed status defaults. Values retain their JSON type for tool writes.
export function declaredFieldChoices(metadata) {
  let options = metadata?.options;
  if (typeof options === 'string') {
    try { options = JSON.parse(options); } catch { return undefined; }
  }
  const entries = Array.isArray(options) ? options : options?.choices;
  if (!Array.isArray(entries)) return undefined;
  const choices = [];
  for (const entry of entries) {
    if (scalar(entry)) {
      choices.push({ value: entry, label: String(entry) });
    } else if (entry && typeof entry === 'object' && !Array.isArray(entry)
      && Object.hasOwn(entry, 'value') && scalar(entry.value)) {
      const label = entry.text ?? entry.label ?? entry.value;
      choices.push({ value: entry.value, label: String(scalar(label) ? label : entry.value) });
    }
  }
  return choices;
}
