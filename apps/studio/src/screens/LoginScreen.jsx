import { useState } from 'react';

import { login } from '../api.js';

export function LoginScreen({ onAuthenticated }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event) {
    event.preventDefault();
    setError('');
    setSubmitting(true);
    try {
      const session = await login(email, password);
      onAuthenticated(session);
    } catch (requestError) {
      setError(requestError.message || 'Sign in failed');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="auth-layout">
      <section className="auth-card" aria-labelledby="login-title">
        <div>
          <p className="eyebrow">YunCMS Studio</p>
          <h1 id="login-title">Sign in</h1>
          <p className="lede">Use an administrator account to manage schema, content, users and permissions.</p>
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

          {error && <div className="error-banner" role="alert">{error}</div>}

          <button className="primary-button" type="submit" disabled={submitting}>
            {submitting ? 'Signing in…' : 'Sign in'}
          </button>
        </form>
      </section>
    </main>
  );
}
