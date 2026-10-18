import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeProviderRouting, providerRoutingFromRow } from '../src/ai/provider-routing.js';
import { normalizeAiSettingsPatch, DEFAULT_AI_SETTINGS } from '../src/ai/config.js';
import { providerRequestBody } from '../src/ai/service.js';

const routing = { only: ['baseten/fast', 'streamlake/fp8'], order: ['baseten/fast', 'streamlake/fp8'],
  ignore: ['example'], quantizations: ['fp8', 'bf16'], require_parameters: true, allow_fallbacks: false };

test('gateway routing is optional and preserves validated server-controlled provider choices without mutating them', () => {
  assert.equal(DEFAULT_AI_SETTINGS.provider, null);
  for (const empty of [undefined, null, {}]) assert.equal(normalizeProviderRouting(empty), null);
  assert.deepEqual(normalizeAiSettingsPatch({ provider: routing }), { provider: routing });
  assert.deepEqual(providerRoutingFromRow(JSON.stringify(routing)), routing);
  assert.deepEqual(providerRoutingFromRow(routing), routing);
  const normalized = normalizeProviderRouting(routing); normalized.only.push('another');
  assert.equal(routing.only.length, 2);
});

test('provider routing rejects credentials, native request overrides, malformed lists, oversize inputs and invalid stored JSON', () => {
  for (const provider of [[], 'openrouter', false, { api_key: 'secret' }, { model: 'changed' }, { max_tokens: 1 },
    { messages: [] }, { stream: true }, { base_url: 'https://other.invalid' }, { only: [] }, { only: ['a', 'a'] },
    { order: 'a' }, { only: Array.from({ length: 33 }, (_, i) => 'p' + i) }, { quantizations: [1] },
    { ignore: ['a\nb'] }, { only: ['x'.repeat(129)] }, { require_parameters: 1 }, { allow_fallbacks: 'true' },
    { only: Array.from({ length: 32 }, (_, i) => 'a'.repeat(126) + i), order: Array.from({ length: 32 }, (_, i) => 'b'.repeat(126) + i) },
    JSON.parse('{"__proto__":{"polluted":true}}')]) {
    assert.throws(() => normalizeAiSettingsPatch({ provider }), { code: 'INVALID_AI_CONFIG' });
  }
  for (const value of ['{broken', '{"api_key":"secret"}', '["provider"]']) assert.throws(() => providerRoutingFromRow(value), { code: 'INVALID_AI_CONFIG' });
  assert.equal({}.polluted, undefined);
});

test('standard OpenAI-compatible requests omit gateway options and empty tools; configured routing reaches both request shapes', () => {
  const config = { ...DEFAULT_AI_SETTINGS, model: 'any-provider/model' }, messages = [{ role: 'user', content: 'Hello' }];
  assert.deepEqual(providerRequestBody(messages, [], config), { model: config.model, messages, max_tokens: 1500 });
  const tools = [{ type: 'function', function: { name: 'native_tool' } }];
  const chat = providerRequestBody(messages, tools, { ...config, provider: routing });
  assert.deepEqual(chat.tools, tools); assert.equal(chat.tool_choice, 'auto'); assert.deepEqual(chat.provider, routing);
  const automation = providerRequestBody(messages, [], { ...config, provider: routing }, { type: 'json_object' });
  assert.deepEqual(automation.provider, routing); assert.deepEqual(automation.response_format, { type: 'json_object' });
  assert.equal(Object.hasOwn(automation, 'tools'), false); assert.equal(Object.hasOwn(automation, 'tool_choice'), false);
  automation.provider.order.reverse(); assert.deepEqual(routing.order, ['baseten/fast', 'streamlake/fp8']);
});
