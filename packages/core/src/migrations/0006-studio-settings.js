export const studioSettingsMigration = {
  id: '0006-studio-settings',
  statements: [
    `CREATE TABLE IF NOT EXISTS yuncms_studio_settings (
      id TINYINT UNSIGNED NOT NULL PRIMARY KEY,
      brand_name VARCHAR(100) NOT NULL DEFAULT 'YunCMS',
      logo_url VARCHAR(512) NOT NULL DEFAULT 'https://yunsoft.com/light-logo.png',
      accent_color CHAR(7) NOT NULL DEFAULT '#2563eb',
      theme VARCHAR(16) NOT NULL DEFAULT 'system',
      default_locale VARCHAR(5) NOT NULL DEFAULT 'en',
      updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
      CONSTRAINT chk_yuncms_studio_settings_singleton CHECK (id = 1),
      CONSTRAINT chk_yuncms_studio_settings_theme CHECK (theme IN ('system', 'light', 'dark')),
      CONSTRAINT chk_yuncms_studio_settings_locale CHECK (default_locale IN ('en', 'tr'))
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
    `INSERT IGNORE INTO yuncms_studio_settings
      (id, brand_name, logo_url, accent_color, theme, default_locale)
     VALUES (1, 'YunCMS', 'https://yunsoft.com/light-logo.png', '#2563eb', 'system', 'en')`,
  ],
};
