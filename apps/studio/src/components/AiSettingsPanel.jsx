import { useEffect, useState } from 'react';

import { saveAiSettings } from '../api.js';
import { useI18n } from '../i18n.js';

function formFromSettings(settings) {
  return {
    enabled: Boolean(settings?.enabled),
    baseUrl: settings?.base_url || 'https://api.openai.com/v1',
    model: settings?.model || '',
    apiKey: '',
    clearApiKey: false,
    writesEnabled: Boolean(settings?.writes_enabled),
    maxToolRounds: settings?.max_tool_rounds ?? 6,
    maxToolCallsPerRound: settings?.max_tool_calls_per_round ?? 8,
    maxHistory: settings?.max_history ?? 20,
    maxMessageChars: settings?.max_message_chars ?? 12000,
    maxToolResultBytes: settings?.max_tool_result_bytes ?? 250000,
    maxOutputTokens: settings?.max_output_tokens ?? 1500,
    timeoutMs: settings?.timeout_ms ?? 60000,
  };
}

export function AiSettingsPanel({ settings, onSaved, onClose }) {
  const { t } = useI18n();
  const [form, setForm] = useState(() => formFromSettings(settings));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  useEffect(() => {
    setForm(formFromSettings(settings));
    setError('');
    setNotice('');
  }, [settings?.updated_at]);

  function set(name, value) {
    setForm((current) => ({ ...current, [name]: value }));
  }

  async function handleSubmit(event) {
    event.preventDefault();
    setSaving(true);
    setError('');
    setNotice('');
    try {
      const patch = {
        enabled: form.enabled,
        base_url: form.baseUrl,
        model: form.model || null,
        writes_enabled: form.writesEnabled,
        max_tool_rounds: Number(form.maxToolRounds),
        max_tool_calls_per_round: Number(form.maxToolCallsPerRound),
        max_history: Number(form.maxHistory),
        max_message_chars: Number(form.maxMessageChars),
        max_tool_result_bytes: Number(form.maxToolResultBytes),
        max_output_tokens: Number(form.maxOutputTokens),
        timeout_ms: Number(form.timeoutMs),
      };
      if (form.apiKey.trim()) patch.api_key = form.apiKey.trim();
      if (form.clearApiKey) patch.clear_api_key = true;
      const next = await saveAiSettings(patch);
      setForm(formFromSettings(next));
      setNotice(t('ai.settingsSaved'));
      await onSaved?.(next);
    } catch (requestError) {
      setError(requestError.message || t('ai.settingsSaveFailed'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <form className="ai-settings-panel panel" onSubmit={handleSubmit}>
      <div className="ai-settings-heading">
        <div>
          <h2>{t('ai.settingsTitle')}</h2>
          <p>{t('ai.settingsDescription')}</p>
        </div>
        <button className="text-button" type="button" onClick={onClose}>{t('ai.settingsClose')}</button>
      </div>

      {error && <div className="error-banner" role="alert">{error}</div>}
      {notice && <div className="success-banner" role="status">{notice}</div>}

      <div className="ai-settings-grid">
        <label className="ai-setting-wide">
          <span>{t('ai.baseUrl')}</span>
          <input value={form.baseUrl} onChange={(event) => set('baseUrl', event.target.value)} placeholder="https://api.openai.com/v1" />
          <small>{t('ai.baseUrlHint')}</small>
        </label>

        <label>
          <span>{t('ai.model')}</span>
          <input value={form.model} onChange={(event) => set('model', event.target.value)} placeholder="gpt-5.6" />
        </label>

        <label>
          <span>{t('ai.apiKey')}</span>
          <input
            type="password"
            autoComplete="new-password"
            value={form.apiKey}
            onChange={(event) => {
              set('apiKey', event.target.value);
              if (event.target.value) set('clearApiKey', false);
            }}
            placeholder={settings?.has_api_key ? t('ai.apiKeySaved') : t('ai.apiKeyPlaceholder')}
          />
          <small>{settings?.has_api_key ? t('ai.apiKeySavedHint') : t('ai.apiKeyHint')}</small>
        </label>
      </div>

      {settings?.has_api_key && (
        <label className="ai-danger-toggle">
          <input
            type="checkbox"
            checked={form.clearApiKey}
            onChange={(event) => set('clearApiKey', event.target.checked)}
          />
          <span>{t('ai.clearApiKey')}</span>
        </label>
      )}

      <div className="ai-settings-toggles">
        <label className="ai-settings-toggle">
          <input type="checkbox" checked={form.enabled} onChange={(event) => set('enabled', event.target.checked)} />
          <span><strong>{t('ai.enableAssistant')}</strong><small>{t('ai.enableAssistantHint')}</small></span>
        </label>
        <label className="ai-settings-toggle">
          <input type="checkbox" checked={form.writesEnabled} onChange={(event) => set('writesEnabled', event.target.checked)} />
          <span><strong>{t('ai.enableWrites')}</strong><small>{t('ai.enableWritesHint')}</small></span>
        </label>
      </div>

      <details className="ai-advanced-settings">
        <summary>{t('ai.advancedSettings')}</summary>
        <div className="ai-settings-grid compact">
          <label><span>{t('ai.maxToolRounds')}</span><input type="number" min="1" max="12" value={form.maxToolRounds} onChange={(event) => set('maxToolRounds', event.target.value)} /></label>
          <label><span>{t('ai.maxToolCalls')}</span><input type="number" min="1" max="20" value={form.maxToolCallsPerRound} onChange={(event) => set('maxToolCallsPerRound', event.target.value)} /></label>
          <label><span>{t('ai.maxHistory')}</span><input type="number" min="1" max="50" value={form.maxHistory} onChange={(event) => set('maxHistory', event.target.value)} /></label>
          <label><span>{t('ai.maxOutputTokens')}</span><input type="number" min="128" max="8192" value={form.maxOutputTokens} onChange={(event) => set('maxOutputTokens', event.target.value)} /></label>
          <label><span>{t('ai.timeout')}</span><input type="number" min="1000" max="180000" step="1000" value={form.timeoutMs} onChange={(event) => set('timeoutMs', event.target.value)} /></label>
          <label><span>{t('ai.maxMessageChars')}</span><input type="number" min="100" max="50000" value={form.maxMessageChars} onChange={(event) => set('maxMessageChars', event.target.value)} /></label>
          <label><span>{t('ai.maxToolResultBytes')}</span><input type="number" min="10000" max="2000000" value={form.maxToolResultBytes} onChange={(event) => set('maxToolResultBytes', event.target.value)} /></label>
        </div>
      </details>

      <div className="ai-settings-actions">
        <button className="primary-button" type="submit" disabled={saving}>{saving ? t('ai.settingsSaving') : t('ai.settingsSave')}</button>
      </div>
    </form>
  );
}

export { formFromSettings };
