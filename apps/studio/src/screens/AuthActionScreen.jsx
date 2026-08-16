import { useEffect, useState } from 'react';

import { apiRequest } from '../api.js';

export function AuthActionScreen({ action, token, onDone }) {
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [state, setState] = useState(action === 'verify' ? 'working' : 'idle');
  const [message, setMessage] = useState('');

  useEffect(() => {
    if (action !== 'verify') return;
    let active = true;
    apiRequest('/auth/email-verification/confirm', {
      method: 'POST',
      body: { token },
    }, { retryAuth: false })
      .then(() => {
        if (!active) return;
        setState('success');
        setMessage('Email address verified. You can return to sign in.');
      })
      .catch((error) => {
        if (!active) return;
        setState('error');
        setMessage(error.message || 'Verification link is invalid or expired.');
      });
    return () => { active = false; };
  }, [action, token]);

  async function resetPassword(event) {
    event.preventDefault();
    setMessage('');
    if (password !== confirmation) {
      setState('error');
      setMessage('Passwords do not match.');
      return;
    }
    setState('working');
    try {
      await apiRequest('/auth/password-reset/confirm', {
        method: 'POST',
        body: { token, password },
      }, { retryAuth: false });
      setState('success');
      setMessage('Password changed. Existing sessions were revoked.');
    } catch (error) {
      setState('error');
      setMessage(error.message || 'Reset link is invalid or expired.');
    }
  }

  return (
    <main className="auth-layout">
      <section className="auth-card" aria-labelledby="auth-action-title">
        <div>
          <p className="eyebrow">YunCMS Studio</p>
          <h1 id="auth-action-title">{action === 'verify' ? 'Verify email' : 'Reset password'}</h1>
          <p className="lede">
            {action === 'verify'
              ? 'Checking the one-time verification token.'
              : 'Choose a new password for your YunCMS account.'}
          </p>
        </div>

        {action === 'reset' && state !== 'success' && (
          <form className="form-stack" onSubmit={resetPassword}>
            <label className="field-label">
              <span>New password</span>
              <input
                type="password"
                autoComplete="new-password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                required
              />
            </label>
            <label className="field-label">
              <span>Confirm password</span>
              <input
                type="password"
                autoComplete="new-password"
                value={confirmation}
                onChange={(event) => setConfirmation(event.target.value)}
                required
              />
            </label>
            <button className="primary-button" type="submit" disabled={state === 'working'}>
              {state === 'working' ? 'Changing password…' : 'Change password'}
            </button>
          </form>
        )}

        {state === 'working' && action === 'verify' && <div className="notice-banner">Verifying…</div>}
        {message && (
          <div className={state === 'error' ? 'error-banner' : 'notice-banner'} role="status">{message}</div>
        )}
        {(state === 'success' || state === 'error') && (
          <button className="primary-button" type="button" onClick={onDone}>Back to sign in</button>
        )}
      </section>
    </main>
  );
}
