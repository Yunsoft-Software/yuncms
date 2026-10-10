export const utcAuthDeadlinesMigration = Object.freeze({
  id: '0022-utc-auth-deadlines',
  statements: [
    'DELETE FROM yuncms_sessions',
    'DELETE FROM yuncms_auth_tokens',
    'DELETE FROM yuncms_auth_transactions',
    'DELETE FROM yuncms_api_tokens WHERE expires_at IS NOT NULL',
  ],
});
