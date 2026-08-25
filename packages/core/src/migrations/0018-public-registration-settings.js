export const publicRegistrationSettingsMigration = {
  id: '0018-public-registration-settings',
  statements: [
    `ALTER TABLE yuncms_studio_settings
      ADD COLUMN public_registration_enabled TINYINT(1) NOT NULL DEFAULT 0 AFTER default_locale,
      ADD COLUMN public_registration_role CHAR(36) NULL AFTER public_registration_enabled,
      ADD CONSTRAINT fk_yuncms_studio_settings_public_registration_role
        FOREIGN KEY (public_registration_role) REFERENCES yuncms_roles(id) ON DELETE SET NULL`,
  ],
};
