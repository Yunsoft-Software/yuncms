export const MAX_JSON_IMPORT_BYTES = 20 * 1024 * 1024;

function invalid(code) { return Object.assign(new Error(code), { code }); }

export function parseJsonImportText(text) {
  if (typeof text !== 'string') throw invalid('JSON_IMPORT_INVALID');
  if (new TextEncoder().encode(text).byteLength > MAX_JSON_IMPORT_BYTES) throw invalid('JSON_IMPORT_TOO_LARGE');
  try { return JSON.parse(text.replace(/^\uFEFF/, '')); }
  catch { throw invalid('JSON_IMPORT_INVALID'); }
}

export async function readJsonImportFile(file) {
  if (file.size > MAX_JSON_IMPORT_BYTES) throw invalid('JSON_IMPORT_TOO_LARGE');
  const text = (await file.text()).replace(/^\uFEFF/, '');
  parseJsonImportText(text);
  return text;
}
