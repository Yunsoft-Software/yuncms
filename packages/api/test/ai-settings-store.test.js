import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import test from 'node:test';

import { AiSettingsStore, decryptAiSecret, encryptAiSecret } from '../src/ai/settings-store.js';

function createDatabase(overrides = {}) {
  const state = {
    id: 1,
    enabled: 0,
    base_url: 'https://api.openai.com/v1',
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
  return {
    state,
    async query(sql, params = []) {
      if (/^\s*SELECT id, enabled/.test(sql)) return [[{ ...state }]];
      if (/^\s*UPDATE yuncms_ai_settings SET/.test(sql)) {
        const assignments = sql.match(/SET ([\s\S]+) WHERE id = \?/)[1].split(',').map((part) => part.trim().split(' = ')[0]);
        assignments.forEach((column, index) => { state[column] = params[index]; });
        return [{ affectedRows: 1 }];
      }
      throw new Error(`Unexpected SQL in test: ${sql}`);
    },
  };
}

test('AI API keys round-trip through AES-GCM and reject the wrong key', () => {
  const key = randomBytes(32);
  const encrypted = encryptAiSecret('provider-secret', key);
  assert.notEqual(encrypted, 'provider-secret');
  assert.equal(decryptAiSecret(encrypted, key), 'provider-secret');
  assert.throws(
    () => decryptAiSecret(encrypted, randomBytes(32)),
    (error) => error.code === 'AI_SECRET_DECRYPT_FAILED',
  );
});

test('AI settings store encrypts a panel API key and never returns it from admin reads', async () => {
  const database = createDatabase();
  const store = new AiSettingsStore({ database, key: randomBytes(32) });
  const settings = await store.update({
    api_key: 'secret-from-panel',
    model: 'example-model',
    enabled: true,
  });
  assert.equal(settings.enabled, true);
  assert.equal(settings.has_api_key, true);
  assert.equal(Object.hasOwn(settings, 'api_key'), false);
  assert.notEqual(database.state.api_key_ciphertext, 'secret-from-panel');
  const runtime = await store.readRuntime();
  assert.equal(runtime.apiKey, 'secret-from-panel');
  assert.equal(runtime.model, 'example-model');
});

test('AI settings cannot be enabled without both model and saved key', async () => {
  const store = new AiSettingsStore({ database: createDatabase(), key: randomBytes(32) });
  await assert.rejects(
    () => store.update({ enabled: true }),
    (error) => error.code === 'INVALID_AI_CONFIG',
  );
});

test('clearing the saved AI key removes runtime credentials', async () => {
  const database = createDatabase();
  const store = new AiSettingsStore({ database, key: randomBytes(32) });
  await store.update({ api_key: 'secret', model: 'model' });
  await store.update({ clear_api_key: true, enabled: false });
  const admin = await store.readAdmin();
  const runtime = await store.readRuntime();
  assert.equal(admin.has_api_key, false);
  assert.equal(runtime.apiKey, null);
});
