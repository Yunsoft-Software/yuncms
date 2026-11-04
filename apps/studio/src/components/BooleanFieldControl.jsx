import { useI18n } from '../i18n.js';

export function BooleanFieldControl({ value, onChange, label, disabled = false }) {
  const { t } = useI18n();
  return <span className="boolean-field-control"><input type="checkbox" aria-label={label} checked={Boolean(value)} disabled={disabled} onChange={event => onChange(event.currentTarget.checked)} /><span aria-hidden="true">{t(value ? 'common.yes' : 'common.no')}</span></span>;
}
