import { useEffect, useState } from 'react';

import { saveAiSettings } from '../api.js';
import { useI18n } from '../i18n.js';
import { AI_PROVIDERS, aiProviderPreset, changeAiProviderEndpoint } from '../ai-providers.js';
import { JsonField } from './JsonField.jsx';

function formFromSettings(settings) {
  return {
    enabled: Boolean(settings?.enabled),
    baseUrl: settings?.base_url || 'https://api.openai.com/v1',
    preset: aiProviderPreset(settings?.base_url || 'https://api.openai.com/v1'),
    provider: settings?.provider ?? null,
    endpointChanged: false,
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
  const [routingValid, setRoutingValid] = useState(true);

  useEffect(() => {
    setForm(formFromSettings(settings));
    setError('');
    setNotice('');
    setRoutingValid(true);
  }, [settings?.updated_at]);

  function set(name, value) {
    setForm((current) => ({ ...current, [name]: value }));
  }

  function endpoint(baseUrl, preset = 'custom') {
    setForm(current => changeAiProviderEndpoint(current, baseUrl, preset));
    setRoutingValid(true);
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
        provider: form.provider,
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
    } catch {
      setError(t('ai.settingsSaveFailed'));
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
      {form.endpointChanged && <p>{t('ai.providerChanged')}</p>}

      <div className="ai-settings-grid">
        <label className="ai-setting-wide">
          <span>{t('ai.provider')}</span>
          <select aria-label={t('ai.provider')} value={form.preset} onChange={event => {
            const preset = event.target.value;
            endpoint(AI_PROVIDERS.find(provider => provider.id === preset)?.baseUrl || form.baseUrl, preset);
          }}>
            {AI_PROVIDERS.map(provider => <option key={provider.id} value={provider.id}>{provider.name}</option>)}
            <option value="custom">{t('ai.customProvider')}</option>
          </select>
          <small>{t('ai.providerHint')}</small>
        </label>
        <label className="ai-setting-wide">
          <span>{t('ai.baseUrl')}</span>
          <input aria-label={t('ai.baseUrl')} type="url" required value={form.baseUrl} onChange={(event) => endpoint(event.target.value)} placeholder="https://api.example.com/v1" />
          <small>{t('ai.baseUrlHint')}</small>
        </label>

        <label>
          <span>{t('ai.model')}</span>
          <input value={form.model} onChange={(event) => set('model', event.target.value)} placeholder="model-id" />
        </label>

        <label>
          <span>{t('ai.apiKey')}</span>
          <input
            type="password"
            aria-label={t('ai.apiKey')}
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
        <JsonField key={form.baseUrl + String(settings?.updated_at)} label={t('ai.providerRouting')} value={form.provider || {}}
          objectOnly onChange={value => set('provider', value)} onValidityChange={setRoutingValid}
          hint={t('ai.providerRoutingHint')} errorLabel={t('ai.invalidProviderRouting')} />
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
        <button className="primary-button" type="submit" disabled={saving || !routingValid}>{saving ? t('ai.settingsSaving') : t('ai.settingsSave')}</button>
      </div>
    </form>
  );
}

export { formFromSettings };
