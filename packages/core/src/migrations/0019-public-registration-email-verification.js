export const publicRegistrationEmailVerificationMigration = {
  id: '0019-public-registration-email-verification',
  statements: [
    `ALTER TABLE yuncms_studio_settings
      ADD COLUMN public_registration_require_email_verification TINYINT(1) NOT NULL DEFAULT 0
      AFTER public_registration_role`,
  ],
};
