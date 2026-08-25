export const mcpSettingsMigration = Object.freeze({
  id: '0017-mcp-settings',
  statements: [
    `CREATE TABLE yuncms_mcp_settings (
      id TINYINT UNSIGNED NOT NULL PRIMARY KEY,
      enabled TINYINT(1) NOT NULL DEFAULT 0,
      writes_enabled TINYINT(1) NOT NULL DEFAULT 0,
      require_authentication TINYINT(1) NOT NULL DEFAULT 1,
      allowed_origins JSON NOT NULL,
      allowed_hosts JSON NOT NULL,
      max_items INT UNSIGNED NOT NULL DEFAULT 100,
      max_result_bytes INT UNSIGNED NOT NULL DEFAULT 1000000,
      updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
      CONSTRAINT chk_yuncms_mcp_settings_singleton CHECK (id = 1)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
    `INSERT INTO yuncms_mcp_settings (id, allowed_origins, allowed_hosts)
     VALUES (1, JSON_ARRAY(), JSON_ARRAY())`,
  ],
});
