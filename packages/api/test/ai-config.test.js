import assert from 'node:assert/strict';
import test from 'node:test';

import { DEFAULT_AI_BASE_URL, loadAiConfig } from '../src/ai/config.js';

test('AI assistant is disabled and read-only by default', () => {
  const config = loadAiConfig({});
  assert.equal(config.enabled, false);
  assert.equal(config.writesEnabled, false);
  assert.equal(config.baseUrl, DEFAULT_AI_BASE_URL);
  assert.equal(config.apiKey, null);
  assert.equal(config.model, null);
  assert.equal(config.maxToolRounds, 6);
  assert.equal(config.maxHistory, 20);
});

test('AI assistant auto-enables when model and API key are configured', () => {
  const config = loadAiConfig({
    AI_API_KEY: 'secret-value',
    AI_MODEL: 'example/model',
    AI_BASE_URL: 'https://openrouter.ai/api/v1/',
    AI_WRITES_ENABLED: 'true',
    AI_MAX_TOOL_ROUNDS: '4',
  });
  assert.equal(config.enabled, true);
  assert.equal(config.writesEnabled, true);
  assert.equal(config.baseUrl, 'https://openrouter.ai/api/v1');
  assert.equal(config.model, 'example/model');
  assert.equal(config.maxToolRounds, 4);
});

test('AI assistant can be explicitly disabled even when credentials exist', () => {
  const config = loadAiConfig({
    AI_ENABLED: 'false',
    AI_API_KEY: 'secret-value',
    AI_MODEL: 'example/model',
  });
  assert.equal(config.enabled, false);
});

test('enabled AI requires both provider credentials and a model', () => {
  assert.throws(
    () => loadAiConfig({ AI_ENABLED: 'true', AI_MODEL: 'example/model' }),
    /AI_API_KEY is required/,
  );
  assert.throws(
    () => loadAiConfig({ AI_ENABLED: 'true', AI_API_KEY: 'secret-value' }),
    /AI_MODEL is required/,
  );
});

test('AI provider URL rejects non-http URLs and embedded credentials', () => {
  assert.throws(
    () => loadAiConfig({ AI_BASE_URL: 'file:///tmp/provider' }),
    /must use http or https/,
  );
  assert.throws(
    () => loadAiConfig({ AI_BASE_URL: 'https://user:pass@example.test/v1' }),
    /cannot include credentials/,
  );
});
