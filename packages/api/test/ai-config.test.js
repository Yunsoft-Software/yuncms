import assert from 'node:assert/strict';
import test from 'node:test';

import {
  aiAdminSettingsFromRow,
  aiRuntimeSettingsFromRow,
  DEFAULT_AI_BASE_URL,
  normalizeAiSettingsPatch,
} from '../src/ai/config.js';

function row(overrides = {}) {
  return {
    id: 1,
    enabled: 0,
    base_url: DEFAULT_AI_BASE_URL,
    model: null,
    api_key_ciphertext: null,
    writes_enabled: 0,
    max_tool_rounds: 6,
    max_tool_calls_per_round: 8,
    max_history: 20,
    max_message_chars: 12000,
    max_tool_result_bytes: 250000,
    max_output_tokens: 1500,
    timeout_ms: 60000,
    updated_at: null,
    ...overrides,
  };
}

test('persisted AI settings default to disabled and read-only', () => {
  const config = aiRuntimeSettingsFromRow(row());
  assert.equal(config.enabled, false);
  assert.equal(config.writesEnabled, false);
  assert.equal(config.baseUrl, DEFAULT_AI_BASE_URL);
  assert.equal(config.apiKey, null);
  assert.equal(config.model, null);
  assert.equal(config.maxToolRounds, 6);
  assert.equal(config.maxToolCallsPerRound, 8);
  assert.equal(config.maxHistory, 20);
});

test('admin settings expose only whether an API key exists', () => {
  const settings = aiAdminSettingsFromRow(row({ api_key_ciphertext: 'encrypted-value', model: 'example/model' }));
  assert.equal(settings.has_api_key, true);
  assert.equal(settings.model, 'example/model');
  assert.equal(Object.hasOwn(settings, 'api_key'), false);
  assert.equal(JSON.stringify(settings).includes('encrypted-value'), false);
});

test('AI settings patch normalizes panel fields', () => {
  assert.deepEqual(normalizeAiSettingsPatch({
    enabled: true,
    base_url: 'https://openrouter.ai/api/v1/',
    model: ' example/model ',
    api_key: ' secret-value ',
    writes_enabled: true,
    max_tool_rounds: 4,
    max_tool_calls_per_round: 5,
  }), {
    enabled: true,
    baseUrl: 'https://openrouter.ai/api/v1',
    model: 'example/model',
    apiKey: 'secret-value',
    writesEnabled: true,
    maxToolRounds: 4,
    maxToolCallsPerRound: 5,
  });
});

test('AI settings reject unsafe provider URLs and conflicting secret changes', () => {
  assert.throws(
    () => normalizeAiSettingsPatch({ base_url: 'file:///tmp/provider' }),
    /must use http or https/,
  );
  assert.throws(
    () => normalizeAiSettingsPatch({ base_url: 'https://user:pass@example.test/v1' }),
    /cannot include credentials/,
  );
  assert.throws(
    () => normalizeAiSettingsPatch({ api_key: 'new', clear_api_key: true }),
    /cannot be set and cleared/,
  );
});

test('AI limits remain bounded when saved from Studio', () => {
  assert.throws(
    () => normalizeAiSettingsPatch({ max_tool_calls_per_round: 0 }),
    /between 1 and 20/,
  );
  assert.throws(
    () => normalizeAiSettingsPatch({ max_tool_calls_per_round: 21 }),
    /between 1 and 20/,
  );
});
