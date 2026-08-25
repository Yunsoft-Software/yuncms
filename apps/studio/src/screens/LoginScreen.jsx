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
import { useStudioSettings } from '../contexts/StudioSettingsContext.jsx';
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
  const { settings } = useStudioSettings();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [resetMode, setResetMode] = useState(false);
  const [registerMode, setRegisterMode] = useState(false);
  const [verificationPending, setVerificationPending] = useState(false);
  const [providers, setProviders] = useState([]);
  const [ldapProviderId, setLdapProviderId] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const registrationEnabled = settings.public_registration_enabled === true;
  const registrationRequiresEmailVerification =
    settings.public_registration_require_email_verification === true;

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
    if (registrationEnabled) return;
    setRegisterMode(false);
    setVerificationPending(false);
    setConfirmPassword('');
  }, [registrationEnabled]);

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
        setVerificationPending(false);
        await apiRequest('/auth/password-reset/request', {
          method: 'POST',
          body: { email },
        }, { retryAuth: false });
        setNotice(t('auth.resetNotice'));
        return;
      }

      if (registerMode) {
        if (password !== confirmPassword) {
          setError(t('auth.passwordMismatch'));
          return;
        }
        const response = await apiRequest('/auth/register', {
          method: 'POST',
          body: { email, password },
        }, { retryAuth: false });
        const verificationRequired = response?.data?.email_verification_required === true;
        setRegisterMode(false);
        setPassword('');
        setConfirmPassword('');
        setVerificationPending(verificationRequired);
        setNotice(verificationRequired
          ? t('auth.registrationVerificationSent')
          : t('auth.registrationComplete'));
        return;
      }

      const session = ldapProvider
        ? await loginWithProvider(ldapProvider.id, email, password)
        : await login(email, password);
      setVerificationPending(false);
      onAuthenticated(session);
    } catch (requestError) {
      if (requestError?.code === 'EMAIL_NOT_VERIFIED') {
        setVerificationPending(true);
        setError(t('auth.emailNotVerified'));
      } else {
        setVerificationPending(false);
        setError(requestError.message || (resetMode ? t('auth.requestFailed') : t('auth.signInFailed')));
      }
    } finally {
      setSubmitting(false);
    }
  }

  async function resendVerification() {
    setSubmitting(true);
    setError('');
    setNotice('');
    try {
      await apiRequest('/auth/email-verification/request', {
        method: 'POST',
        body: { email },
      }, { retryAuth: false });
      setNotice(t('auth.verificationResent'));
    } catch (requestError) {
      setError(requestError.message || t('auth.requestFailed'));
    } finally {
      setSubmitting(false);
    }
  }

  function beginBrowserProvider(provider) {
    setError('');
    setVerificationPending(false);
    window.location.assign(externalLoginUrl(provider.id, '/'));
  }

  function chooseLdapProvider(provider) {
    setResetMode(false);
    setRegisterMode(false);
    setVerificationPending(false);
    setLdapProviderId(provider.id);
    setEmail('');
    setPassword('');
    setConfirmPassword('');
    setError('');
    setNotice('');
  }

  function switchRegisterMode(nextMode) {
    setRegisterMode(nextMode);
    setResetMode(false);
    setVerificationPending(false);
    setLdapProviderId('');
    setPassword('');
    setConfirmPassword('');
    setError('');
    setNotice('');
  }

  const title = registerMode
    ? t('auth.createAccount')
    : resetMode
      ? t('auth.resetPassword')
      : t('auth.signIn');
  const description = registerMode
    ? t('auth.createAccountDescription')
    : resetMode
      ? t('auth.resetDescription')
      : (ldapProvider?.label ?? t('auth.signInDescription'));

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
            <h1 id="login-title">{title}</h1>
            <p className="lede">{description}</p>
          </div>

          <form className="form-stack" onSubmit={handleSubmit}>
            <label className="field-label">
              <span>{ldapProvider?.label ?? t('auth.email')}</span>
              <input
                autoComplete="username"
                type={ldapProvider ? 'text' : 'email'}
                value={email}
                onChange={(event) => {
                  setEmail(event.target.value);
                  setVerificationPending(false);
                }}
                required
              />
            </label>

            {!resetMode && (
              <label className="field-label">
                <span>{t('auth.password')}</span>
                <input
                  autoComplete={registerMode ? 'new-password' : 'current-password'}
                  type="password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  required
                />
              </label>
            )}

            {registerMode && (
              <label className="field-label">
                <span>{t('auth.confirmPassword')}</span>
                <input
                  autoComplete="new-password"
                  type="password"
                  value={confirmPassword}
                  onChange={(event) => setConfirmPassword(event.target.value)}
                  required
                />
              </label>
            )}

            {error && <div className="error-banner" role="alert">{error}</div>}
            {notice && <div className="notice-banner" role="status">{notice}</div>}

            <button className="primary-button" type="submit" disabled={submitting}>
              {submitting
                ? t('auth.working')
                : registerMode
                  ? t('auth.createAccount')
                  : resetMode
                    ? t('auth.sendResetLink')
                    : t('auth.signIn')}
            </button>

            {verificationPending
              && registrationEnabled
              && registrationRequiresEmailVerification
              && !registerMode
              && !resetMode
              && !ldapProvider && (
              <button
                className="secondary-button"
                type="button"
                disabled={submitting || !email}
                onClick={resendVerification}
              >
                {t('auth.resendVerification')}
              </button>
            )}

            {!ldapProvider && !registerMode && (
              <button
                className="text-button"
                type="button"
                onClick={() => {
                  setResetMode((current) => !current);
                  setVerificationPending(false);
                  setError('');
                  setNotice('');
                }}
              >
                {resetMode ? t('auth.backToSignIn') : t('auth.forgotPassword')}
              </button>
            )}

            {registrationEnabled && !ldapProvider && !resetMode && (
              <button
                className="text-button"
                type="button"
                onClick={() => switchRegisterMode(!registerMode)}
              >
                {registerMode ? t('auth.haveAccount') : t('auth.needAccount')}
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

          {!resetMode && !registerMode && !ldapProvider && (browserProviders.length > 0 || ldapProviders.length > 0) && (
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
