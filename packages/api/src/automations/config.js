import { createHash } from 'node:crypto';

export function automationError(code, message) {
  return Object.assign(new Error(message), { code });
}

const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]{0,63}$/;
export const AI_AUTOMATION_ORIGIN = Symbol('YunCMS AI automation');
const KEYS = new Set(['name', 'collection', 'run_as', 'enabled', 'on_create', 'on_update', 'input_fields', 'output_fields', 'instruction']);

export function normalizeAutomation(input) {
  const fail = (message) => { throw automationError('INVALID_AUTOMATION', message); };
  if (!input || typeof input !== 'object' || Array.isArray(input)
    || Object.keys(input).some((key) => !KEYS.has(key))) fail('Unsupported automation properties');
  const text = (key, max) => {
    if (typeof input[key] !== 'string' || !input[key].trim() || input[key].trim().length > max) fail(`Invalid ${key}`);
    return input[key].trim();
  };
  const fields = (key) => {
    const value = input[key];
    if (!Array.isArray(value) || !value.length || value.length > 10
      || value.some((field) => typeof field !== 'string' || !IDENTIFIER.test(field))
      || new Set(value).size !== value.length) fail(`${key} must contain 1–10 distinct field keys`);
    return [...value];
  };
  const bool = (key, fallback) => {
    if (input[key] === undefined) return fallback;
    if (typeof input[key] !== 'boolean') fail(`${key} must be a boolean`);
    return input[key];
  };
  const rule = {
    name: text('name', 120), collection: text('collection', 64), run_as: text('run_as', 36),
    instruction: text('instruction', 8000), input_fields: fields('input_fields'), output_fields: fields('output_fields'),
    enabled: bool('enabled', false), on_create: bool('on_create', true), on_update: bool('on_update', false),
  };
  if (!IDENTIFIER.test(rule.collection) || rule.collection.startsWith('yuncms_')) fail('Choose a project collection');
  if (!rule.on_create && !rule.on_update) fail('Choose at least one trigger');
  if (rule.output_fields.some((field) => rule.input_fields.includes(field))) fail('Input and output fields must not overlap');
  return rule;
}

export function automationFromRow(row) {
  if (!row) return null;
  const parse = (value) => typeof value === 'string' ? JSON.parse(value) : value;
  return { ...row, enabled: Boolean(row.enabled), on_create: Boolean(row.on_create), on_update: Boolean(row.on_update),
    input_fields: parse(row.input_fields), output_fields: parse(row.output_fields) };
}

export function matchesAutomation(rule, event, payload, context) {
  if (!rule.enabled || rule.collection !== context.collection
    || context[AI_AUTOMATION_ORIGIN] === true) return false;
  if (event === 'items.create') return rule.on_create === true;
  return event === 'items.update' && rule.on_update === true
    && rule.input_fields.some((field) => Object.hasOwn(payload.changes ?? {}, field));
}

export function recordFingerprint(record, fields) {
  return createHash('sha256').update(JSON.stringify(fields.map((field) => [field, record[field]]))).digest('hex');
}

export function validateGeneratedFields(value, fields) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).length !== fields.length
    || Object.keys(value).some((key) => !fields.includes(key))
    || fields.some((key) => !Object.hasOwn(value, key))
    || Buffer.byteLength(JSON.stringify(value)) > 50_000) {
    throw automationError('AI_PROVIDER_RESPONSE_INVALID', 'AI must return exactly the configured output fields');
  }
  return value;
}
