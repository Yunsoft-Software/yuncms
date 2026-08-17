export const sessionAccessTokensMigration = {
  id: '0002-session-access-tokens',
  statements: [
    `ALTER TABLE yuncms_sessions
      ADD COLUMN access_token_hash CHAR(64) NULL AFTER token_hash,
      ADD COLUMN access_expires_at DATETIME(3) NULL AFTER access_token_hash,
      ADD UNIQUE KEY uq_yuncms_sessions_access_token_hash (access_token_hash),
      ADD KEY idx_yuncms_sessions_access_expires_at (access_expires_at)`,
  ],
};
