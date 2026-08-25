export const DEFAULT_MCP_SETTINGS = Object.freeze({
  enabled: false,
  writesEnabled: false,
  requireAuthentication: true,
  allowedOrigins: Object.freeze([]),
  allowedHosts: Object.freeze([]),
  maxItems: 100,
  maxResultBytes: 1_000_000,
});

const PATCH_KEYS = new Set([
  'enabled',
  'writes_enabled',
  'require_authentication',
  'allowed_origins',
  'allowed_hosts',
  'max_items',
  'max_result_bytes',
]);

function configError(message) {
  const error = new Error(message);
  error.code = 'INVALID_MCP_CONFIG';
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

function listValues(value, name) {
  let source = value;
  if (typeof source === 'string') {
    const trimmed = source.trim();
    if (trimmed.startsWith('[')) {
      try {
        source = JSON.parse(trimmed);
      } catch {
        throw configError(`${name} must be a list`);
      }
    } else {
      source = source.split(/[\n,]/);
    }
  }
  if (!Array.isArray(source)) throw configError(`${name} must be a list`);
  const entries = source.map((entry) => {
    if (typeof entry !== 'string') throw configError(`${name} entries must be strings`);
    return entry.trim();
  }).filter(Boolean);
  if (entries.length > 50) throw configError(`${name} cannot contain more than 50 entries`);
  return entries;
}

export function normalizeMcpOrigins(value) {
  return [...new Set(listValues(value, 'allowed_origins').map((entry) => {
    let url;
    try {
      url = new URL(entry);
    } catch {
      throw configError(`allowed_origins contains an invalid URL: ${entry}`);
    }
    if (!['http:', 'https:'].includes(url.protocol)) {
      throw configError(`allowed_origins must use http or https: ${entry}`);
    }
    if (url.username || url.password) {
      throw configError(`allowed_origins cannot include credentials: ${entry}`);
    }
    return url.origin.toLowerCase();
  }))];
}

export function normalizeMcpHosts(value) {
  return [...new Set(listValues(value, 'allowed_hosts').map((entry) => {
    if (/[:][/][/]|[\\/?#@\s\0]/.test(entry)) {
      throw configError(`allowed_hosts contains an invalid host: ${entry}`);
    }
    let url;
    try {
      url = new URL(`http://${entry}`);
    } catch {
      throw configError(`allowed_hosts contains an invalid host: ${entry}`);
    }
    if (url.username || url.password || url.pathname !== '/' || url.search || url.hash || !url.host) {
      throw configError(`allowed_hosts contains an invalid host: ${entry}`);
    }
    return url.host.toLowerCase();
  }))];
}

export function normalizeMcpSettingsPatch(patch = {}) {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) {
    throw configError('MCP settings patch must be an object');
  }
  const keys = Object.keys(patch);
  if (keys.length === 0 || keys.some((key) => !PATCH_KEYS.has(key))) {
    throw configError('MCP settings patch contains unsupported properties');
  }
  const normalized = {};
  if (Object.hasOwn(patch, 'enabled')) normalized.enabled = normalizeBoolean(patch.enabled, 'enabled');
  if (Object.hasOwn(patch, 'writes_enabled')) normalized.writesEnabled = normalizeBoolean(patch.writes_enabled, 'writes_enabled');
  if (Object.hasOwn(patch, 'require_authentication')) normalized.requireAuthentication = normalizeBoolean(patch.require_authentication, 'require_authentication');
  if (Object.hasOwn(patch, 'allowed_origins')) normalized.allowedOrigins = normalizeMcpOrigins(patch.allowed_origins);
  if (Object.hasOwn(patch, 'allowed_hosts')) normalized.allowedHosts = normalizeMcpHosts(patch.allowed_hosts);
  if (Object.hasOwn(patch, 'max_items')) normalized.maxItems = normalizeInteger(patch.max_items, 'max_items', { min: 1, max: 500 });
  if (Object.hasOwn(patch, 'max_result_bytes')) normalized.maxResultBytes = normalizeInteger(patch.max_result_bytes, 'max_result_bytes', { min: 10_000, max: 10_000_000 });
  return normalized;
}

function rowList(value, name, normalize) {
  try {
    return normalize(value);
  } catch (error) {
    if (error?.code === 'INVALID_MCP_CONFIG') throw error;
    throw configError(`${name} contains invalid saved data`);
  }
}

export function mcpRuntimeSettingsFromRow(row) {
  if (!row) throw configError('MCP settings are missing; run YunCMS bootstrap');
  return Object.freeze({
    enabled: Boolean(row.enabled),
    writesEnabled: Boolean(row.writes_enabled),
    requireAuthentication: Boolean(row.require_authentication),
    allowedOrigins: Object.freeze(rowList(row.allowed_origins, 'allowed_origins', normalizeMcpOrigins)),
    allowedHosts: Object.freeze(rowList(row.allowed_hosts, 'allowed_hosts', normalizeMcpHosts)),
    maxItems: normalizeInteger(row.max_items, 'max_items', { min: 1, max: 500 }),
    maxResultBytes: normalizeInteger(row.max_result_bytes, 'max_result_bytes', { min: 10_000, max: 10_000_000 }),
  });
}

export function mcpAdminSettingsFromRow(row) {
  const runtime = mcpRuntimeSettingsFromRow(row);
  return {
    enabled: runtime.enabled,
    writes_enabled: runtime.writesEnabled,
    require_authentication: runtime.requireAuthentication,
    allowed_origins: [...runtime.allowedOrigins],
    allowed_hosts: [...runtime.allowedHosts],
    max_items: runtime.maxItems,
    max_result_bytes: runtime.maxResultBytes,
    updated_at: row.updated_at ?? null,
  };
}

export { configError };
