export const studioLogoFileMigration = {
  id: '0008-studio-logo-file',
  statements: [
    `ALTER TABLE yuncms_studio_settings
       ADD COLUMN logo_file CHAR(36) NULL AFTER logo_url,
       ADD KEY idx_yuncms_studio_settings_logo_file (logo_file),
       ADD CONSTRAINT fk_yuncms_studio_settings_logo_file
         FOREIGN KEY (logo_file) REFERENCES yuncms_files (id) ON DELETE SET NULL`,
  ],
};
