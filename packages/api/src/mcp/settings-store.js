import {
  mcpAdminSettingsFromRow,
  mcpRuntimeSettingsFromRow,
  normalizeMcpSettingsPatch,
} from './config.js';

function settingsError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function columnAssignments(normalized) {
  const assignments = [];
  const params = [];
  const add = (column, value) => {
    assignments.push(`${column} = ?`);
    params.push(value);
  };
  if (Object.hasOwn(normalized, 'enabled')) add('enabled', normalized.enabled ? 1 : 0);
  if (Object.hasOwn(normalized, 'writesEnabled')) add('writes_enabled', normalized.writesEnabled ? 1 : 0);
  if (Object.hasOwn(normalized, 'requireAuthentication')) add('require_authentication', normalized.requireAuthentication ? 1 : 0);
  if (Object.hasOwn(normalized, 'allowedOrigins')) add('allowed_origins', JSON.stringify(normalized.allowedOrigins));
  if (Object.hasOwn(normalized, 'allowedHosts')) add('allowed_hosts', JSON.stringify(normalized.allowedHosts));
  if (Object.hasOwn(normalized, 'maxItems')) add('max_items', normalized.maxItems);
  if (Object.hasOwn(normalized, 'maxResultBytes')) add('max_result_bytes', normalized.maxResultBytes);
  return { assignments, params };
}

export class McpSettingsStore {
  constructor({ database } = {}) {
    if (!database) throw new Error('MCP settings store requires database');
    this.database = database;
  }

  async #row() {
    const [rows] = await this.database.query(
      `SELECT id, enabled, writes_enabled, require_authentication, allowed_origins,
              allowed_hosts, max_items, max_result_bytes, updated_at
       FROM yuncms_mcp_settings
       WHERE id = 1
       LIMIT 1`,
    );
    const row = rows[0];
    if (!row) throw settingsError('DATABASE_MIGRATION_REQUIRED', 'MCP settings are missing; run YunCMS bootstrap');
    return row;
  }

  async readAdmin() {
    return mcpAdminSettingsFromRow(await this.#row());
  }

  async readRuntime() {
    return mcpRuntimeSettingsFromRow(await this.#row());
  }

  async update(patch = {}) {
    const normalized = normalizeMcpSettingsPatch(patch);
    const current = await this.#row();
    const { assignments, params } = columnAssignments(normalized);
    if (assignments.length === 0) throw settingsError('INVALID_MCP_CONFIG', 'MCP settings patch has no effective changes');

    const effectiveEnabled = Object.hasOwn(normalized, 'enabled') ? normalized.enabled : Boolean(current.enabled);
    const effectiveAllowedHosts = Object.hasOwn(normalized, 'allowedHosts')
      ? normalized.allowedHosts
      : mcpRuntimeSettingsFromRow(current).allowedHosts;
    if (effectiveEnabled && effectiveAllowedHosts.length === 0) {
      throw settingsError('INVALID_MCP_CONFIG', 'Add at least one allowed host before enabling MCP');
    }

    params.push(1);
    await this.database.query(
      `UPDATE yuncms_mcp_settings SET ${assignments.join(', ')} WHERE id = ?`,
      params,
    );
    return this.readAdmin();
  }
}
