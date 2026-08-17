import { useEffect, useState } from 'react';

import { apiRequest } from '../api.js';
import { LanguageSwitcher, StudioBrand, YunsoftFooter } from '../components/StudioBrand.jsx';
import { useI18n } from '../i18n.js';

export function AuthActionScreen({ action, token, onDone }) {
  const { t } = useI18n();
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [state, setState] = useState(action === 'verify' ? 'working' : 'idle');
  const [messageKey, setMessageKey] = useState('');

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
        setMessageKey('auth.actionDone');
      })
      .catch(() => {
        if (!active) return;
        setState('error');
        setMessageKey('auth.actionFailed');
      });
    return () => { active = false; };
  }, [action, token]);

  async function resetPassword(event) {
    event.preventDefault();
    setMessageKey('');
    if (password !== confirmation) {
      setState('error');
      setMessageKey('auth.passwordMismatch');
      return;
    }
    setState('working');
    try {
      await apiRequest('/auth/password-reset/confirm', {
        method: 'POST',
        body: { token, password },
      }, { retryAuth: false });
      setState('success');
      setMessageKey('auth.passwordChanged');
    } catch {
      setState('error');
      setMessageKey('auth.actionFailed');
    }
  }

  return (
    <main className="auth-layout">
      <div className="auth-shell">
        <div className="auth-branding">
          <StudioBrand />
          <LanguageSwitcher compact />
        </div>
        <section className="auth-card" aria-labelledby="auth-action-title">
          <div>
            <p className="eyebrow">YunCMS {t('app.studio')}</p>
            <h1 id="auth-action-title">{action === 'verify' ? t('auth.verifyEmail') : t('auth.resetPassword')}</h1>
            <p className="lede">
              {action === 'verify' ? t('auth.verifyDescription') : t('auth.newPasswordDescription')}
            </p>
          </div>

          {action === 'reset' && state !== 'success' && (
            <form className="form-stack" onSubmit={resetPassword}>
              <label className="field-label">
                <span>{t('auth.newPassword')}</span>
                <input
                  type="password"
                  autoComplete="new-password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  required
                />
              </label>
              <label className="field-label">
                <span>{t('auth.confirmPassword')}</span>
                <input
                  type="password"
                  autoComplete="new-password"
                  value={confirmation}
                  onChange={(event) => setConfirmation(event.target.value)}
                  required
                />
              </label>
              <button className="primary-button" type="submit" disabled={state === 'working'}>
                {state === 'working' ? t('auth.actionWorking') : t('auth.setNewPassword')}
              </button>
            </form>
          )}

          {state === 'working' && action === 'verify' && <div className="notice-banner">{t('auth.actionWorking')}</div>}
          {messageKey && (
            <div className={state === 'error' ? 'error-banner' : 'notice-banner'} role="status">{t(messageKey)}</div>
          )}
          {(state === 'success' || state === 'error') && (
            <button className="primary-button" type="button" onClick={onDone}>{t('auth.backToSignIn')}</button>
          )}
        </section>
        <div className="auth-footer"><YunsoftFooter /></div>
      </div>
    </main>
  );
}
