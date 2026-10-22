import { useI18n } from '../i18n.js';

export function SecondFactorInput({ value, onChange, recovery = false, onRecoveryChange, disabled = false }) {
  const { t } = useI18n();
  return <div className="form-stack">
    <label className="field-label"><span>{t(recovery ? 'tfa.recoveryCode' : 'tfa.code')}</span>
      <input type="text" inputMode={recovery ? 'text' : 'numeric'} autoComplete="one-time-code" value={value}
        onChange={event => onChange(event.target.value)} required minLength={recovery ? 32 : 6} maxLength={recovery ? 39 : 6}
        pattern={recovery ? undefined : '[0-9]{6}'} disabled={disabled} />
    </label>
    {onRecoveryChange && <button className="text-button" type="button" disabled={disabled} onClick={() => { onChange(''); onRecoveryChange(!recovery); }}>
      {t(recovery ? 'tfa.useTotp' : 'tfa.useRecovery')}
    </button>}
  </div>;
}
