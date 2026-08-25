import { useEffect, useMemo, useState } from 'react';

import { API_URL, mcpSettings, saveMcpSettings } from '../api.js';
import { useI18n } from '../i18n.js';
import { mcpFormFromSettings, mcpSettingsPatch } from '../mcp-settings.js';

function browserDefaults() {
  let host = '';
  try {
    host = new URL(API_URL).host;
  } catch {
    host = window.location.host;
  }
  return { origin: window.location.origin, host };
}

export function McpScreen() {
  const { t } = useI18n();
  const defaults = useMemo(browserDefaults, []);
  const [settings, setSettings] = useState(null);
  const [form, setForm] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  useEffect(() => {
    let cancelled = false;
    mcpSettings()
      .then((next) => {
        if (cancelled) return;
        setSettings(next);
        setForm(mcpFormFromSettings(next, defaults));
        setError('');
      })
      .catch((requestError) => {
        if (!cancelled) setError(requestError.message || t('mcp.loadFailed'));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [defaults, t]);

  function set(name, value) {
    setForm((current) => ({ ...current, [name]: value }));
  }

  async function handleSubmit(event) {
    event.preventDefault();
    setSaving(true);
    setError('');
    setNotice('');
    try {
      const next = await saveMcpSettings(mcpSettingsPatch(form));
      setSettings(next);
      setForm(mcpFormFromSettings(next, defaults));
      setNotice(t('mcp.saved'));
    } catch (requestError) {
      setError(requestError.message || t('mcp.saveFailed'));
    } finally {
      setSaving(false);
    }
  }

  const endpoint = `${API_URL.replace(/\/$/, '')}/mcp`;

  if (loading) return <div className="panel mcp-state-card">{t('common.loading')}</div>;
  if (!form) return <div className="error-banner" role="alert">{error || t('mcp.loadFailed')}</div>;

  return (
    <section className="mcp-workspace" aria-label={t('mcp.title')}>
      <form className="panel mcp-settings-panel" onSubmit={handleSubmit}>
        <div className="mcp-intro">
          <div>
            <h2>{t('mcp.settingsTitle')}</h2>
            <p>{t('mcp.settingsDescription')}</p>
          </div>
          <span className={`status-pill ${form.enabled ? 'active' : 'inactive'}`}>
            {t(form.enabled ? 'mcp.enabled' : 'mcp.disabled')}
          </span>
        </div>

        {error && <div className="error-banner" role="alert">{error}</div>}
        {notice && <div className="success-banner" role="status">{notice}</div>}

        <div className="mcp-endpoint-card">
          <span>{t('mcp.endpoint')}</span>
          <code>{endpoint}</code>
          <small>{t('mcp.endpointHint')}</small>
        </div>

        <div className="mcp-toggle-grid">
          <label className="mcp-toggle">
            <input type="checkbox" checked={form.enabled} onChange={(event) => set('enabled', event.target.checked)} />
            <span><strong>{t('mcp.enable')}</strong><small>{t('mcp.enableHint')}</small></span>
          </label>
          <label className={`mcp-toggle ${form.writesEnabled ? 'warning' : ''}`}>
            <input type="checkbox" checked={form.writesEnabled} onChange={(event) => set('writesEnabled', event.target.checked)} />
            <span><strong>{t('mcp.writes')}</strong><small>{t('mcp.writesHint')}</small></span>
          </label>
          <label className={`mcp-toggle ${!form.requireAuthentication ? 'warning' : ''}`}>
            <input type="checkbox" checked={form.requireAuthentication} onChange={(event) => set('requireAuthentication', event.target.checked)} />
            <span><strong>{t('mcp.authentication')}</strong><small>{t('mcp.authenticationHint')}</small></span>
          </label>
        </div>

        {form.writesEnabled && <div className="mcp-warning" role="status">{t('mcp.writesWarning')}</div>}
        {!form.requireAuthentication && <div className="mcp-warning danger" role="alert">{t('mcp.publicWarning')}</div>}

        <div className="mcp-settings-grid">
          <label>
            <span>{t('mcp.allowedHosts')}</span>
            <textarea rows="4" value={form.allowedHosts} onChange={(event) => set('allowedHosts', event.target.value)} placeholder="api.example.com" />
            <small>{t('mcp.allowedHostsHint')}</small>
          </label>
          <label>
            <span>{t('mcp.allowedOrigins')}</span>
            <textarea rows="4" value={form.allowedOrigins} onChange={(event) => set('allowedOrigins', event.target.value)} placeholder="https://studio.example.com" />
            <small>{t('mcp.allowedOriginsHint')}</small>
          </label>
        </div>

        <details className="mcp-advanced-settings">
          <summary>{t('mcp.advanced')}</summary>
          <div className="mcp-limit-grid">
            <label>
              <span>{t('mcp.maxItems')}</span>
              <input type="number" min="1" max="500" value={form.maxItems} onChange={(event) => set('maxItems', event.target.value)} />
              <small>{t('mcp.maxItemsHint')}</small>
            </label>
            <label>
              <span>{t('mcp.maxResultBytes')}</span>
              <input type="number" min="10000" max="10000000" step="10000" value={form.maxResultBytes} onChange={(event) => set('maxResultBytes', event.target.value)} />
              <small>{t('mcp.maxResultBytesHint')}</small>
            </label>
          </div>
        </details>

        <div className="mcp-actions">
          <small>{settings?.updated_at ? t('mcp.lastUpdated', { value: new Date(settings.updated_at).toLocaleString() }) : t('mcp.notSavedYet')}</small>
          <button className="primary-button" type="submit" disabled={saving}>
            {saving ? t('common.saving') : t('common.save')}
          </button>
        </div>
      </form>
    </section>
  );
}
