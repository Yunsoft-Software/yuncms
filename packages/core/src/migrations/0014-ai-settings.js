export const aiSettingsMigration = Object.freeze({
  id: '0014-ai-settings',
  statements: [
    `CREATE TABLE yuncms_ai_settings (
      id TINYINT UNSIGNED NOT NULL PRIMARY KEY,
      enabled TINYINT(1) NOT NULL DEFAULT 0,
      base_url VARCHAR(2048) NOT NULL DEFAULT 'https://api.openai.com/v1',
      model VARCHAR(200) NULL,
      api_key_ciphertext TEXT NULL,
      writes_enabled TINYINT(1) NOT NULL DEFAULT 0,
      max_tool_rounds INT UNSIGNED NOT NULL DEFAULT 6,
      max_tool_calls_per_round INT UNSIGNED NOT NULL DEFAULT 6,
      max_history INT UNSIGNED NOT NULL DEFAULT 20,
      max_message_chars INT UNSIGNED NOT NULL DEFAULT 12000,
      max_tool_result_bytes INT UNSIGNED NOT NULL DEFAULT 250000,
      max_output_tokens INT UNSIGNED NOT NULL DEFAULT 1500,
      timeout_ms INT UNSIGNED NOT NULL DEFAULT 60000,
      updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
      CONSTRAINT chk_yuncms_ai_settings_singleton CHECK (id = 1)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
    `INSERT INTO yuncms_ai_settings (id) VALUES (1)`,
  ],
});
