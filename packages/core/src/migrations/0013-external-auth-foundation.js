export const externalAuthFoundationMigration = {
  id: '0013-external-auth-foundation',
  statements: [
    `CREATE TABLE IF NOT EXISTS yuncms_auth_identities (
      id CHAR(36) NOT NULL PRIMARY KEY,
      provider VARCHAR(64) NOT NULL,
      subject VARCHAR(255) NOT NULL,
      user CHAR(36) NOT NULL,
      email VARCHAR(191) NULL,
      profile JSON NULL,
      last_login_at DATETIME(3) NULL,
      created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
      UNIQUE KEY uq_yuncms_auth_identity_provider_subject (provider, subject),
      KEY idx_yuncms_auth_identity_user (user),
      CONSTRAINT fk_yuncms_auth_identity_user FOREIGN KEY (user)
        REFERENCES yuncms_users (id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,

    `CREATE TABLE IF NOT EXISTS yuncms_auth_transactions (
      id CHAR(36) NOT NULL PRIMARY KEY,
      provider VARCHAR(64) NOT NULL,
      state_hash CHAR(64) NOT NULL,
      secret_ciphertext TEXT NULL,
      redirect_target VARCHAR(512) NULL,
      metadata JSON NULL,
      expires_at DATETIME(3) NOT NULL,
      used_at DATETIME(3) NULL,
      created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      UNIQUE KEY uq_yuncms_auth_transaction_state (state_hash),
      KEY idx_yuncms_auth_transaction_provider_expiry (provider, expires_at),
      KEY idx_yuncms_auth_transaction_expiry (expires_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
  ],
};
