export const studioFaviconFileMigration = {
  id: '0010-studio-favicon-file',
  statements: [
    `ALTER TABLE yuncms_studio_settings
      ADD COLUMN favicon_file CHAR(36) NULL AFTER logo_file`,
    `ALTER TABLE yuncms_studio_settings
      ADD KEY idx_yuncms_studio_settings_favicon_file (favicon_file)`,
    `ALTER TABLE yuncms_studio_settings
      ADD CONSTRAINT fk_yuncms_studio_settings_favicon_file
      FOREIGN KEY (favicon_file) REFERENCES yuncms_files (id) ON DELETE SET NULL`,
  ],
};
