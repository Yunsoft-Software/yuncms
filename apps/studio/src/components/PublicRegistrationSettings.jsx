import { useEffect, useMemo, useState } from 'react';

import { apiRequest } from '../api.js';
import { useStudioSettings } from '../contexts/StudioSettingsContext.jsx';
import { useI18n } from '../i18n.js';

export function PublicRegistrationSettings() {
  const { saveSettings } = useStudioSettings();
  const { t } = useI18n();
  const [available, setAvailable] = useState(false);
  const [roles, setRoles] = useState([]);
  const [enabled, setEnabled] = useState(false);
  const [role, setRole] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      apiRequest('/studio-settings/admin'),
      apiRequest('/roles'),
    ])
      .then(([settingsResponse, rolesResponse]) => {
        if (cancelled) return;
        const settings = settingsResponse?.data ?? {};
        const eligibleRoles = (rolesResponse?.data ?? []).filter((entry) => !entry.admin && !entry.public);
        setRoles(eligibleRoles);
        setEnabled(settings.public_registration_enabled === true);
        setRole(settings.public_registration_role || '');
        setAvailable(true);
      })
      .catch((requestError) => {
        if (cancelled) return;
        if (requestError?.status !== 403) setError(requestError.message || t('registration.loadFailed'));
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [t]);

  const selectedRoleExists = useMemo(
    () => !role || roles.some((entry) => entry.id === role),
    [role, roles],
  );

  if (loading || (!available && !error)) return null;
  if (!available) {
    return <div className="error-banner" role="alert">{error}</div>;
  }

  async function handleSave(event) {
    event.preventDefault();
    setSaving(true);
    setError('');
    setNotice('');
    try {
      await saveSettings({
        public_registration_enabled: enabled,
        public_registration_role: role || null,
      });
      setNotice(t('registration.saved'));
    } catch (requestError) {
      setError(requestError.message || t('registration.saveFailed'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="panel appearance-form" aria-labelledby="public-registration-title">
      <div className="panel-header appearance-heading">
        <div>
          <p className="eyebrow">{t('registration.eyebrow')}</p>
          <h2 id="public-registration-title">{t('registration.title')}</h2>
          <p>{t('registration.description')}</p>
        </div>
      </div>

      {error && <div className="error-banner" role="alert">{error}</div>}
      {notice && <div className="notice-banner" role="status">{notice}</div>}

      <form className="form-stack" onSubmit={handleSave}>
        <label className="field-label">
          <span>{t('registration.defaultRole')}</span>
          <select value={role} onChange={(event) => { setRole(event.target.value); setNotice(''); }}>
            <option value="">{t('registration.chooseRole')}</option>
            {roles.map((entry) => (
              <option key={entry.id} value={entry.id}>{entry.name}</option>
            ))}
          </select>
          <small>{t('registration.roleHint')}</small>
        </label>

        {!selectedRoleExists && (
          <div className="error-banner" role="alert">{t('registration.roleMissing')}</div>
        )}
        {roles.length === 0 && (
          <div className="notice-banner" role="status">{t('registration.noRoles')}</div>
        )}

        <label className="field-label">
          <span>{t('registration.allowPublic')}</span>
          <input
            type="checkbox"
            checked={enabled}
            disabled={!enabled && (!role || !selectedRoleExists)}
            onChange={(event) => { setEnabled(event.target.checked); setNotice(''); }}
          />
          <small>{t('registration.enabledHint')}</small>
        </label>

        <div className="form-actions">
          <button
            className="primary-button"
            type="submit"
            disabled={saving || (enabled && (!role || !selectedRoleExists))}
          >
            {saving ? t('common.saving') : t('common.save')}
          </button>
        </div>
      </form>
    </section>
  );
}
