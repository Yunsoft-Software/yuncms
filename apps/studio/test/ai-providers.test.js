import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { mutationText, operationText } from '../src/ai-operations.js';
import { AI_PROVIDERS, aiProviderPreset, changeAiProviderEndpoint } from '../src/ai-providers.js';
import { DICTIONARIES, translate } from '../src/localization.js';

test('provider shortcuts cover independent compatible APIs and leave arbitrary endpoints and models selectable', () => {
  assert.deepEqual(AI_PROVIDERS.map(x => x.id), ['openai', 'openrouter', 'zai', 'deepseek', 'groq']);
  for (const provider of AI_PROVIDERS) {
    assert.equal(aiProviderPreset(provider.baseUrl + '/'), provider.id);
    assert.equal(Object.hasOwn(provider, 'model'), false);
  }
  for (const url of ['https://private.example.test/compatible', 'http://127.0.0.1:8000/v1', 'https://api.other-provider.test']) assert.equal(aiProviderPreset(url), 'custom');
});

test('changing endpoints clears staged credentials and routing and requires explicit re-enabling', () => {
  const form = { baseUrl: AI_PROVIDERS[1].baseUrl, preset: 'openrouter', model: 'chosen-model', apiKey: 'old-provider-key', enabled: true,
    clearApiKey: false, provider: { only: ['specific-provider'] }, maxOutputTokens: 2048 };
  const original = structuredClone(form), changed = changeAiProviderEndpoint(form, AI_PROVIDERS[2].baseUrl, 'zai');
  assert.deepEqual(form, original); assert.equal(changed.preset, 'zai'); assert.equal(changed.apiKey, '');
  assert.equal(changed.clearApiKey, true); assert.equal(changed.enabled, false); assert.equal(changed.provider, null);
  assert.equal(changed.endpointChanged, true); assert.equal(changed.model, form.model); assert.equal(changed.maxOutputTokens, 2048);
  const same = changeAiProviderEndpoint(form, form.baseUrl + '/', 'custom');
  assert.equal(same.apiKey, form.apiKey); assert.equal(same.enabled, true); assert.deepEqual(same.provider, form.provider);
});

test('provider, routing and mutation-receipt controls have text in every Studio locale', () => {
  for (const [locale, dictionary] of Object.entries(DICTIONARIES)) {
    for (const key of [
      'ai.provider',
      'ai.customProvider',
      'ai.providerHint',
      'ai.providerChanged',
      'ai.providerRouting',
      'ai.providerRoutingHint',
      'ai.invalidProviderRouting',
      'ai.mutations',
      'ai.mutationCreate',
      'ai.mutationUpdate',
      'ai.mutationDelete',
      'ai.noMutations',
    ]) assert.ok(dictionary[key], locale + ':' + key);
  }
  const tEn = (key, values) => translate('en', key, values);
  const tTr = (key, values) => translate('tr', key, values);
  assert.equal(
    mutationText({ operation: 'items_delete', collection: 'articles', id: 'abc-123' }, tEn),
    'Deleted articles #abc-123',
  );
  assert.equal(
    mutationText({ operation: 'items_update', collection: 'articles', id: 'abc-123' }, tTr),
    'articles #abc-123 güncellendi',
  );
  assert.equal(mutationText({ operation: 'items_read_one', collection: 'articles', id: '1' }, tEn), '');
  assert.equal(operationText({ operation: 'items_delete', collection: 'articles', success: true }, tEn), 'Deleted a articles record');

  const screenSource = readFileSync(new URL('../src/screens/AiScreen.jsx', import.meta.url), 'utf8');
  assert.match(screenSource, /className="ai-mutation-list"/);
  assert.match(screenSource, /t\('ai\.noMutations'\)/);
  assert.match(screenSource, /mutationText\(mutation, t\)/);
});
