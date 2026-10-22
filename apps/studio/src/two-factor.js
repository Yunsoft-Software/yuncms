export function authenticationResult(result) {
  if (result?.mfa_required === true && typeof result.challenge_token === 'string') return 'challenge';
  if (result?.access_token && result?.refresh_token && result?.user?.id) return 'session';
  throw new Error('Invalid authentication response');
}

export function factorVerification(value, useRecovery = false) {
  return useRecovery ? { recovery_code: value } : { code: value };
}
