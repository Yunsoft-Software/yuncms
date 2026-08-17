import { useState } from 'react';

import { apiRequest, login } from '../api.js';
import { LanguageSwitcher, StudioBrand, YunsoftFooter } from '../components/StudioBrand.jsx';
import { useI18n } from '../i18n.js';

export function LoginScreen({ onAuthenticated }) {
  const { t } = useI18n();
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
        setNotice(t('auth.resetNotice'));
        return;
      }

      const session = await login(email, password);
      onAuthenticated(session);
    } catch (requestError) {
      setError(requestError.message || (resetMode ? t('auth.requestFailed') : t('auth.signInFailed')));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="auth-layout">
      <div className="auth-shell">
        <div className="auth-branding">
          <StudioBrand />
          <LanguageSwitcher compact />
        </div>
        <section className="auth-card" aria-labelledby="login-title">
          <div>
            <p className="eyebrow">YunCMS {t('app.studio')}</p>
            <h1 id="login-title">{resetMode ? t('auth.resetPassword') : t('auth.signIn')}</h1>
            <p className="lede">
              {resetMode ? t('auth.resetDescription') : t('auth.signInDescription')}
            </p>
          </div>

          <form className="form-stack" onSubmit={handleSubmit}>
            <label className="field-label">
              <span>{t('auth.email')}</span>
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
                <span>{t('auth.password')}</span>
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
              {submitting ? t('auth.working') : (resetMode ? t('auth.sendResetLink') : t('auth.signIn'))}
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
              {resetMode ? t('auth.backToSignIn') : t('auth.forgotPassword')}
            </button>
          </form>
        </section>
        <div className="auth-footer"><YunsoftFooter /></div>
      </div>
    </main>
  );
}
