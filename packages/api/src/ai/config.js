const DEFAULT_AI_BASE_URL = 'https://api.openai.com/v1';

function configError(message) {
  const error = new Error(message);
  error.code = 'INVALID_AI_CONFIG';
  return error;
}

function readBoolean(value, fallback = false) {
  if (value === undefined || value === '') return fallback;
  if (value === true || value === 'true' || value === '1') return true;
  if (value === false || value === 'false' || value === '0') return false;
  throw configError(`Expected boolean value, received: ${value}`);
}

function readInteger(value, fallback, name, { min, max }) {
  if (value === undefined || value === '') return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
    throw configError(`${name} must be an integer between ${min} and ${max}`);
  }
  return parsed;
}

function readOptionalString(value, { max = 500 } = {}) {
  const normalized = String(value ?? '').trim();
  if (!normalized) return null;
  if (normalized.length > max) throw configError(`AI configuration value cannot exceed ${max} characters`);
  return normalized;
}

function readBaseUrl(value) {
  const raw = readOptionalString(value, { max: 2_000 }) ?? DEFAULT_AI_BASE_URL;
  let url;
  try {
    url = new URL(raw);
  } catch {
    throw configError('AI_BASE_URL must be a valid URL');
  }
  if (!['http:', 'https:'].includes(url.protocol)) {
    throw configError('AI_BASE_URL must use http or https');
  }
  if (url.username || url.password || url.search || url.hash) {
    throw configError('AI_BASE_URL cannot include credentials, query parameters or fragments');
  }
  return url.toString().replace(/\/+$/, '');
}

export function loadAiConfig(env = process.env) {
  const apiKey = readOptionalString(env.AI_API_KEY, { max: 8_192 });
  const model = readOptionalString(env.AI_MODEL, { max: 200 });
  const enabled = readBoolean(env.AI_ENABLED, Boolean(apiKey && model));

  if (enabled && !apiKey) throw configError('AI_API_KEY is required when AI is enabled');
  if (enabled && !model) throw configError('AI_MODEL is required when AI is enabled');

  return Object.freeze({
    enabled,
    baseUrl: readBaseUrl(env.AI_BASE_URL),
    apiKey,
    model,
    writesEnabled: readBoolean(env.AI_WRITES_ENABLED, false),
    maxToolRounds: readInteger(env.AI_MAX_TOOL_ROUNDS, 6, 'AI_MAX_TOOL_ROUNDS', { min: 1, max: 12 }),
    maxHistory: readInteger(env.AI_MAX_HISTORY, 20, 'AI_MAX_HISTORY', { min: 1, max: 50 }),
    maxMessageChars: readInteger(env.AI_MAX_MESSAGE_CHARS, 12_000, 'AI_MAX_MESSAGE_CHARS', { min: 100, max: 50_000 }),
    maxToolResultBytes: readInteger(env.AI_MAX_TOOL_RESULT_BYTES, 250_000, 'AI_MAX_TOOL_RESULT_BYTES', { min: 10_000, max: 2_000_000 }),
    maxOutputTokens: readInteger(env.AI_MAX_OUTPUT_TOKENS, 1_500, 'AI_MAX_OUTPUT_TOKENS', { min: 128, max: 8_192 }),
    timeoutMs: readInteger(env.AI_TIMEOUT_MS, 60_000, 'AI_TIMEOUT_MS', { min: 1_000, max: 180_000 }),
  });
}

export { DEFAULT_AI_BASE_URL };
