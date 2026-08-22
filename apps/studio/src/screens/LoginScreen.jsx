import { useEffect, useMemo, useState } from 'react';

import {
  authProviders,
  exchangeAuthCode,
  externalLoginUrl,
  login,
  loginWithProvider,
  apiRequest,
} from '../api.js';
import { LanguageSwitcher, StudioBrand, YunsoftFooter } from '../components/StudioBrand.jsx';
import { useI18n } from '../i18n.js';

function readBrowserAuthCode() {
  const params = new URLSearchParams(window.location.search);
  return params.get('auth_code');
}

function clearBrowserAuthCode() {
  const url = new URL(window.location.href);
  url.searchParams.delete('auth_code');
  window.history.replaceState(null, '', `${url.pathname}${url.search}${url.hash}`);
}

export function LoginScreen({ onAuthenticated }) {
  const { t } = useI18n();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [resetMode, setResetMode] = useState(false);
  const [providers, setProviders] = useState([]);
  const [ldapProviderId, setLdapProviderId] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const ldapProvider = useMemo(
    () => providers.find((provider) => provider.id === ldapProviderId && provider.driver === 'ldap') ?? null,
    [ldapProviderId, providers],
  );
  const browserProviders = providers.filter((provider) => provider.driver !== 'ldap');
  const ldapProviders = providers.filter((provider) => provider.driver === 'ldap');

  useEffect(() => {
    let cancelled = false;
    authProviders()
      .then((items) => { if (!cancelled) setProviders(items); })
      .catch(() => { if (!cancelled) setProviders([]); });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    const authCode = readBrowserAuthCode();
    if (!authCode) return;
    let cancelled = false;
    setSubmitting(true);
    setError('');
    exchangeAuthCode(authCode)
      .then((session) => {
        clearBrowserAuthCode();
        if (!cancelled) onAuthenticated(session);
      })
      .catch((requestError) => {
        clearBrowserAuthCode();
        if (!cancelled) setError(requestError.message || t('auth.signInFailed'));
      })
      .finally(() => { if (!cancelled) setSubmitting(false); });
    return () => { cancelled = true; };
  }, [onAuthenticated, t]);

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

      const session = ldapProvider
        ? await loginWithProvider(ldapProvider.id, email, password)
        : await login(email, password);
      onAuthenticated(session);
    } catch (requestError) {
      setError(requestError.message || (resetMode ? t('auth.requestFailed') : t('auth.signInFailed')));
    } finally {
      setSubmitting(false);
    }
  }

  function beginBrowserProvider(provider) {
    setError('');
    window.location.assign(externalLoginUrl(provider.id, '/'));
  }

  function chooseLdapProvider(provider) {
    setResetMode(false);
    setLdapProviderId(provider.id);
    setEmail('');
    setPassword('');
    setError('');
    setNotice('');
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
              {resetMode
                ? t('auth.resetDescription')
                : (ldapProvider?.label ?? t('auth.signInDescription'))}
            </p>
          </div>

          <form className="form-stack" onSubmit={handleSubmit}>
            <label className="field-label">
              <span>{ldapProvider?.label ?? t('auth.email')}</span>
              <input
                autoComplete="username"
                type={ldapProvider ? 'text' : 'email'}
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
            {!ldapProvider && (
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
            )}
            {ldapProvider && (
              <button
                className="text-button"
                type="button"
                onClick={() => setLdapProviderId('')}
              >
                {t('auth.backToSignIn')}
              </button>
            )}
          </form>

          {!resetMode && !ldapProvider && (browserProviders.length > 0 || ldapProviders.length > 0) && (
            <div className="form-stack" aria-label="Authentication providers">
              {browserProviders.map((provider) => (
                <button
                  key={provider.id}
                  className="secondary-button"
                  type="button"
                  disabled={submitting}
                  onClick={() => beginBrowserProvider(provider)}
                >
                  {provider.label}
                </button>
              ))}
              {ldapProviders.map((provider) => (
                <button
                  key={provider.id}
                  className="secondary-button"
                  type="button"
                  disabled={submitting}
                  onClick={() => chooseLdapProvider(provider)}
                >
                  {provider.label}
                </button>
              ))}
            </div>
          )}
        </section>
        <div className="auth-footer"><YunsoftFooter /></div>
      </div>
    </main>
  );
}

export { clearBrowserAuthCode, readBrowserAuthCode };
