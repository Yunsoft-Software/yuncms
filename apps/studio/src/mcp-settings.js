export function splitMcpList(value = '') {
  return [...new Set(String(value)
    .split(/[\n,]/)
    .map((entry) => entry.trim())
    .filter(Boolean))];
}

export function mcpFormFromSettings(settings, { origin = '', host = '' } = {}) {
  const origins = Array.isArray(settings?.allowed_origins) && settings.allowed_origins.length > 0
    ? settings.allowed_origins
    : origin ? [origin] : [];
  const hosts = Array.isArray(settings?.allowed_hosts) && settings.allowed_hosts.length > 0
    ? settings.allowed_hosts
    : host ? [host] : [];
  return {
    enabled: Boolean(settings?.enabled),
    writesEnabled: Boolean(settings?.writes_enabled),
    requireAuthentication: settings?.require_authentication !== false,
    allowedOrigins: origins.join('\n'),
    allowedHosts: hosts.join('\n'),
    maxItems: settings?.max_items ?? 100,
    maxResultBytes: settings?.max_result_bytes ?? 1_000_000,
  };
}

export function mcpSettingsPatch(form) {
  return {
    enabled: Boolean(form.enabled),
    writes_enabled: Boolean(form.writesEnabled),
    require_authentication: Boolean(form.requireAuthentication),
    allowed_origins: splitMcpList(form.allowedOrigins),
    allowed_hosts: splitMcpList(form.allowedHosts),
    max_items: Number(form.maxItems),
    max_result_bytes: Number(form.maxResultBytes),
  };
}
