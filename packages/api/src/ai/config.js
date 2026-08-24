const DEFAULT_AI_BASE_URL = 'https://api.openai.com/v1';

export const DEFAULT_AI_SETTINGS = Object.freeze({
  enabled: false,
  baseUrl: DEFAULT_AI_BASE_URL,
  model: null,
  writesEnabled: false,
  maxToolRounds: 6,
  maxToolCallsPerRound: 8,
  maxHistory: 20,
  maxMessageChars: 12_000,
  maxToolResultBytes: 250_000,
  maxOutputTokens: 1_500,
  timeoutMs: 60_000,
});

const PATCH_KEYS = new Set([
  'enabled',
  'base_url',
  'model',
  'api_key',
  'clear_api_key',
  'writes_enabled',
  'max_tool_rounds',
  'max_tool_calls_per_round',
  'max_history',
  'max_message_chars',
  'max_tool_result_bytes',
  'max_output_tokens',
  'timeout_ms',
]);

function configError(message) {
  const error = new Error(message);
  error.code = 'INVALID_AI_CONFIG';
  return error;
}

function normalizeBoolean(value, name) {
  if (typeof value !== 'boolean') throw configError(`${name} must be a boolean`);
  return value;
}

function normalizeInteger(value, name, { min, max }) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
    throw configError(`${name} must be an integer between ${min} and ${max}`);
  }
  return parsed;
}

function normalizeOptionalString(value, name, { max = 500 } = {}) {
  if (value == null || value === '') return null;
  if (typeof value !== 'string') throw configError(`${name} must be a string`);
  const normalized = value.trim();
  if (!normalized) return null;
  if (normalized.length > max) throw configError(`${name} cannot exceed ${max} characters`);
  return normalized;
}

function normalizeBaseUrl(value) {
  const raw = normalizeOptionalString(value, 'AI base URL', { max: 2_000 }) ?? DEFAULT_AI_BASE_URL;
  let url;
  try {
    url = new URL(raw);
  } catch {
    throw configError('AI base URL must be a valid URL');
  }
  if (!['http:', 'https:'].includes(url.protocol)) {
    throw configError('AI base URL must use http or https');
  }
  if (url.username || url.password || url.search || url.hash) {
    throw configError('AI base URL cannot include credentials, query parameters or fragments');
  }
  return url.toString().replace(/\/+$/, '');
}

export function normalizeAiSettingsPatch(patch = {}) {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) {
    throw configError('AI settings patch must be an object');
  }
  const keys = Object.keys(patch);
  if (keys.length === 0 || keys.some((key) => !PATCH_KEYS.has(key))) {
    throw configError('AI settings patch contains unsupported properties');
  }

  const normalized = {};
  if (Object.hasOwn(patch, 'enabled')) normalized.enabled = normalizeBoolean(patch.enabled, 'enabled');
  if (Object.hasOwn(patch, 'base_url')) normalized.baseUrl = normalizeBaseUrl(patch.base_url);
  if (Object.hasOwn(patch, 'model')) normalized.model = normalizeOptionalString(patch.model, 'model', { max: 200 });
  if (Object.hasOwn(patch, 'api_key')) {
    const apiKey = normalizeOptionalString(patch.api_key, 'API key', { max: 8_192 });
    if (!apiKey) throw configError('API key cannot be empty; use clear_api_key to remove it');
    normalized.apiKey = apiKey;
  }
  if (Object.hasOwn(patch, 'clear_api_key')) normalized.clearApiKey = normalizeBoolean(patch.clear_api_key, 'clear_api_key');
  if (normalized.apiKey && normalized.clearApiKey) throw configError('API key cannot be set and cleared in the same request');
  if (Object.hasOwn(patch, 'writes_enabled')) normalized.writesEnabled = normalizeBoolean(patch.writes_enabled, 'writes_enabled');
  if (Object.hasOwn(patch, 'max_tool_rounds')) normalized.maxToolRounds = normalizeInteger(patch.max_tool_rounds, 'max_tool_rounds', { min: 1, max: 12 });
  if (Object.hasOwn(patch, 'max_tool_calls_per_round')) normalized.maxToolCallsPerRound = normalizeInteger(patch.max_tool_calls_per_round, 'max_tool_calls_per_round', { min: 1, max: 20 });
  if (Object.hasOwn(patch, 'max_history')) normalized.maxHistory = normalizeInteger(patch.max_history, 'max_history', { min: 1, max: 50 });
  if (Object.hasOwn(patch, 'max_message_chars')) normalized.maxMessageChars = normalizeInteger(patch.max_message_chars, 'max_message_chars', { min: 100, max: 50_000 });
  if (Object.hasOwn(patch, 'max_tool_result_bytes')) normalized.maxToolResultBytes = normalizeInteger(patch.max_tool_result_bytes, 'max_tool_result_bytes', { min: 10_000, max: 2_000_000 });
  if (Object.hasOwn(patch, 'max_output_tokens')) normalized.maxOutputTokens = normalizeInteger(patch.max_output_tokens, 'max_output_tokens', { min: 128, max: 8_192 });
  if (Object.hasOwn(patch, 'timeout_ms')) normalized.timeoutMs = normalizeInteger(patch.timeout_ms, 'timeout_ms', { min: 1_000, max: 180_000 });
  return normalized;
}

export function aiRuntimeSettingsFromRow(row, { apiKey = null } = {}) {
  if (!row) throw configError('AI settings are missing; run YunCMS bootstrap');
  return Object.freeze({
    enabled: Boolean(row.enabled),
    baseUrl: normalizeBaseUrl(row.base_url),
    apiKey,
    model: normalizeOptionalString(row.model, 'model', { max: 200 }),
    writesEnabled: Boolean(row.writes_enabled),
    maxToolRounds: normalizeInteger(row.max_tool_rounds, 'max_tool_rounds', { min: 1, max: 12 }),
    maxToolCallsPerRound: normalizeInteger(row.max_tool_calls_per_round, 'max_tool_calls_per_round', { min: 1, max: 20 }),
    maxHistory: normalizeInteger(row.max_history, 'max_history', { min: 1, max: 50 }),
    maxMessageChars: normalizeInteger(row.max_message_chars, 'max_message_chars', { min: 100, max: 50_000 }),
    maxToolResultBytes: normalizeInteger(row.max_tool_result_bytes, 'max_tool_result_bytes', { min: 10_000, max: 2_000_000 }),
    maxOutputTokens: normalizeInteger(row.max_output_tokens, 'max_output_tokens', { min: 128, max: 8_192 }),
    timeoutMs: normalizeInteger(row.timeout_ms, 'timeout_ms', { min: 1_000, max: 180_000 }),
  });
}

export function aiAdminSettingsFromRow(row) {
  const runtime = aiRuntimeSettingsFromRow(row);
  return {
    enabled: runtime.enabled,
    base_url: runtime.baseUrl,
    model: runtime.model,
    has_api_key: Boolean(row.api_key_ciphertext),
    writes_enabled: runtime.writesEnabled,
    max_tool_rounds: runtime.maxToolRounds,
    max_tool_calls_per_round: runtime.maxToolCallsPerRound,
    max_history: runtime.maxHistory,
    max_message_chars: runtime.maxMessageChars,
    max_tool_result_bytes: runtime.maxToolResultBytes,
    max_output_tokens: runtime.maxOutputTokens,
    timeout_ms: runtime.timeoutMs,
    updated_at: row.updated_at ?? null,
  };
}

export { DEFAULT_AI_BASE_URL, configError, normalizeBaseUrl };
