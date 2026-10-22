export const nativeTotpMigration = Object.freeze({
  id: '0027-native-totp',
  statements: [
    `CREATE TABLE IF NOT EXISTS yuncms_user_totp (
      user CHAR(36) NOT NULL PRIMARY KEY,
      revision CHAR(36) NOT NULL,
      secret_ciphertext TEXT NULL,
      enabled_at DATETIME(3) NULL,
      pending_ciphertext TEXT NULL,
      pending_expires_at DATETIME(3) NULL,
      last_used_step BIGINT NULL,
      recovery_hashes JSON NULL,
      failed_attempts INT NOT NULL DEFAULT 0,
      locked_until DATETIME(3) NULL,
      CONSTRAINT fk_yuncms_totp_user FOREIGN KEY (user) REFERENCES yuncms_users (id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
    `CREATE TABLE IF NOT EXISTS yuncms_mfa_challenges (
      user CHAR(36) NOT NULL PRIMARY KEY,
      token_hash CHAR(64) NOT NULL,
      factor_revision CHAR(36) NOT NULL,
      password_fingerprint CHAR(64) NOT NULL,
      method VARCHAR(16) NOT NULL,
      provider VARCHAR(64) NULL,
      expires_at DATETIME(3) NOT NULL,
      attempts INT NOT NULL DEFAULT 0,
      UNIQUE KEY uq_yuncms_mfa_challenge_hash (token_hash),
      CONSTRAINT fk_yuncms_mfa_user FOREIGN KEY (user) REFERENCES yuncms_users (id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
  ],
});
