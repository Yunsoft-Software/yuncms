import { useEffect, useState } from 'react';
import { apiRequest, writeSession } from '../api.js';
import { factorVerification } from '../two-factor.js';
import { useI18n } from '../i18n.js';
import { SecondFactorInput } from './SecondFactorInput.jsx';

export function TwoFactorPanel() {
  const { t } = useI18n();
  const [status, setStatus] = useState(null), [pending, setPending] = useState(null), [codes, setCodes] = useState(null);
  const [password, setPassword] = useState(''), [code, setCode] = useState(''), [recovery, setRecovery] = useState(false);
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState('');
  const request = async (path = '', options = {}) => (await apiRequest('/auth/tfa' + path, options, { retryAuth: false })).data;
  useEffect(() => { let active = true; request().then(value => { if (active) setStatus(value); }).catch(e => { if (active) setError(e.message); }); return () => { active = false; }; }, []);
  async function perform(path, body = {}, method = 'POST') {
    setBusy(true); setError(''); setNotice('');
    try {
      const result = await request(path, { method, body });
      if (result.session) writeSession(result.session);
      if (path === '/enroll' && method === 'POST') { setPending(result); setCodes(null); }
      else { setPending(null); setPassword(''); setCode(''); setRecovery(false); }
      if (result.recovery_codes) setCodes(result.recovery_codes);
      setStatus(await request());
      if (result.enabled === false) setNotice(t('tfa.disabled'));
    } catch (e) { setError(e.message); }
    finally { setBusy(false); }
  }
  return <section className="panel form-panel" aria-label={t('tfa.title')}>
    <h2>{t('tfa.title')}</h2><p>{t('tfa.description')}</p>
    {error && <div className="error-banner" role="alert">{error}</div>}
    {notice && <div className="notice-banner" role="status">{notice}</div>}
    {!status && !error && <p>{t('common.loading')}</p>}
    {status && <>
      <p role="status">{t(status.enabled ? 'tfa.enabled' : 'tfa.disabled')}</p>
      {!status.available ? <p>{t('tfa.unavailable')}</p> : <>
        {codes ? <div className="form-stack"><h3>{t('tfa.recoveryCodes')}</h3><p>{t('tfa.saveCodes')}</p>
          <pre className="credential-codes" data-testid="recovery-codes"><code>{codes.join('\n')}</code></pre>
          <button className="primary-button" type="button" onClick={() => setCodes(null)}>{t('tfa.savedCodes')}</button>
        </div> : <form className="form-stack" onSubmit={event => { event.preventDefault(); perform(pending ? '/confirm' : status.enabled ? '/disable' : '/enroll', { password, ...(pending || status.enabled ? factorVerification(code, recovery) : {}) }); }}>
          <label className="field-label"><span>{t('tfa.password')}</span><input type="password" autoComplete="current-password" value={password} onChange={event => setPassword(event.target.value)} required disabled={busy} /></label>
          {pending && <div className="form-stack"><p>{t('tfa.setupInstructions')}</p>
            <label className="field-label"><span>{t('tfa.setupKey')}</span><input readOnly value={pending.secret} autoComplete="off" /></label>
          </div>}
          {(pending || status.enabled) && <SecondFactorInput value={code} onChange={setCode} recovery={recovery} onRecoveryChange={status.enabled ? setRecovery : undefined} disabled={busy} />}
          <div className="form-actions"><button className="primary-button" type="submit" disabled={busy}>{t(pending ? 'tfa.confirm' : status.enabled ? 'tfa.disable' : 'tfa.start')}</button>
            {pending && <button className="secondary-button" type="button" disabled={busy} onClick={() => perform('/enroll', {}, 'DELETE')}>{t('common.cancel')}</button>}
            {status.enabled && <button className="secondary-button" type="button" disabled={busy || !password || !code} onClick={() => perform('/recovery-codes', { password, ...factorVerification(code, recovery) })}>{t('tfa.regenerate')}</button>}
          </div>
        </form>}
      </>}
    </>}
  </section>;
}
