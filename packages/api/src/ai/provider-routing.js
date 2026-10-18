const KEYS = new Set(['only', 'order', 'ignore', 'quantizations', 'require_parameters', 'allow_fallbacks']);

function invalid() {
  return Object.assign(new Error('AI provider routing must contain only bounded provider lists and boolean routing flags'), { code: 'INVALID_AI_CONFIG' });
}

// Optional gateway extension. Never accepts credentials, destinations, model,
// messages, tools or token limits; those remain owned by the native request.
export function normalizeProviderRouting(value) {
  if (value == null) return null;
  if (typeof value !== 'object' || Array.isArray(value)
    || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) throw invalid();
  const result = {};
  for (const [key, entry] of Object.entries(value)) {
    if (!KEYS.has(key)) throw invalid();
    if (['require_parameters', 'allow_fallbacks'].includes(key)) {
      if (typeof entry !== 'boolean') throw invalid();
      result[key] = entry;
    } else {
      if (!Array.isArray(entry) || entry.length === 0 || entry.length > 32 || entry.some(item => typeof item !== 'string' || !/^[a-zA-Z0-9_./-]{1,128}$/.test(item))) throw invalid();
      if (new Set(entry).size !== entry.length) throw invalid();
      result[key] = [...entry];
    }
  }
  if (Buffer.byteLength(JSON.stringify(result), 'utf8') > 8192) throw invalid();
  return Object.keys(result).length ? result : null;
}

export function providerRoutingFromRow(value) {
  if (typeof value === 'string') {
    try { value = JSON.parse(value); } catch { throw invalid(); }
  }
  return normalizeProviderRouting(value);
}
