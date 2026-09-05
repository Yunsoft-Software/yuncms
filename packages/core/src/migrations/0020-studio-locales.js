export const studioLocalesMigration = {
  id: '0020-studio-locales',
  statements: [
    `ALTER TABLE yuncms_studio_settings
      DROP CHECK chk_yuncms_studio_settings_locale,
      ADD CONSTRAINT chk_yuncms_studio_settings_locale
        CHECK (default_locale IN ('en', 'tr', 'es', 'de', 'fr', 'pt-BR', 'ja', 'zh-CN'))`,
  ],
};
