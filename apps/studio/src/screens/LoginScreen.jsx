import { useState } from 'react';

import { apiRequest, login } from '../api.js';

export function LoginScreen({ onAuthenticated }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [resetMode, setResetMode] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event) {
    event.preventDefault();
    setError('');
    setNotice('');
    setSubmitting(true);
    try {
      if (resetMode) {
        await apiRequest('/auth/password-reset/request', {
          method: 'POST',
          body: { email },
        }, { retryAuth: false });
        setNotice('If an active account matches this email, a reset link will be sent.');
        return;
      }

      const session = await login(email, password);
      onAuthenticated(session);
    } catch (requestError) {
      setError(requestError.message || (resetMode ? 'Request failed' : 'Sign in failed'));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="auth-layout">
      <section className="auth-card" aria-labelledby="login-title">
        <div>
          <p className="eyebrow">YunCMS Studio</p>
          <h1 id="login-title">{resetMode ? 'Reset password' : 'Sign in'}</h1>
          <p className="lede">
            {resetMode
              ? 'Enter your account email to request a one-time reset link.'
              : 'Use an administrator account to manage schema, content, users and permissions.'}
          </p>
        </div>

        <form className="form-stack" onSubmit={handleSubmit}>
          <label className="field-label">
            <span>Email</span>
            <input
              autoComplete="username"
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              required
            />
          </label>

          {!resetMode && (
            <label className="field-label">
              <span>Password</span>
              <input
                autoComplete="current-password"
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                required
              />
            </label>
          )}

          {error && <div className="error-banner" role="alert">{error}</div>}
          {notice && <div className="notice-banner" role="status">{notice}</div>}

          <button className="primary-button" type="submit" disabled={submitting}>
            {submitting ? 'Working…' : (resetMode ? 'Send reset link' : 'Sign in')}
          </button>
          <button
            className="text-button"
            type="button"
            onClick={() => {
              setResetMode((current) => !current);
              setError('');
              setNotice('');
            }}
          >
            {resetMode ? 'Back to sign in' : 'Forgot password?'}
          </button>
        </form>
      </section>
    </main>
  );
}
