export const authActionTokensMigration = {
  id: '0004-auth-action-tokens',
  statements: [
    `CREATE TABLE IF NOT EXISTS yuncms_auth_tokens (
      id CHAR(36) NOT NULL PRIMARY KEY,
      user CHAR(36) NOT NULL,
      type VARCHAR(24) NOT NULL,
      token_hash CHAR(64) NOT NULL,
      expires_at DATETIME(3) NOT NULL,
      used_at DATETIME(3) NULL,
      created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      UNIQUE KEY uq_yuncms_auth_tokens_hash (token_hash),
      KEY idx_yuncms_auth_tokens_user_type (user, type),
      KEY idx_yuncms_auth_tokens_expires (expires_at),
      CONSTRAINT fk_yuncms_auth_tokens_user FOREIGN KEY (user)
        REFERENCES yuncms_users (id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
  ],
};
