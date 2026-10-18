import assert from 'node:assert/strict';
import test from 'node:test';
import { createAccountability, HookEmitter } from '@yunsoft/yuncms-core';
import { AiAssistantService } from '../src/ai/service.js';
import { statusForError } from '../src/error-response.js';
import { DEFAULT_AI_SETTINGS } from '../src/ai/config.js';

const config = { enabled: true, apiKey: 'disposable-invalid-key', model: 'unused',
  baseUrl: 'https://invalid.invalid/v1', maxMessageChars: 12000, maxOutputTokens: 1000, timeoutMs: 1000 };
const input = { instruction: 'Summarize', input: { message: 'Admission regression' }, outputFields: ['summary'] };

test('hook-enabled field generation fails closed without an execution identity', async () => {
  const assistant = new AiAssistantService({ config, emitter: new HookEmitter() });
  await assert.rejects(assistant.generateFields(input), error => {
    assert.equal(error.code, 'AI_ADMISSION_UNAVAILABLE');
    assert.equal(statusForError(error), 503);
    return true;
  });
});

test('field generation admission uses the verified execution identity and propagates denial', async () => {
  const emitter = new HookEmitter();
  const context = { accountability: createAccountability({ user: 'normal-run-as', role: 'normal-role' }), requestId: 'native-generation' };
  const events = [];
  emitter.registerFilter('ai.provider.before', (payload, event) => {
    assert.equal(event.accountability, context.accountability);
    assert.equal(event.requestId, context.requestId);
    assert.equal(event.accountability.admin, false);
    assert.ok(payload.estimated_max_tokens > config.maxOutputTokens);
    events.push(payload.call_id);
    throw Object.assign(new Error('Capacity exhausted'), { code: 'AI_TOKENS_EXHAUSTED', status: 402 });
  });
  emitter.registerAction('ai.provider.failed', (payload, event) => {
    assert.equal(event.accountability, context.accountability);
    assert.equal(payload.call_id, events[0]);
    assert.equal(payload.provider_completed, false);
    events.push(payload.code);
  });
  const assistant = new AiAssistantService({ config, emitter });
  await assert.rejects(assistant.generateFields(input, context), { code: 'AI_TOKENS_EXHAUSTED', status: 402 });
  assert.equal(events.length, 2);
  assert.equal(events[1], 'AI_TOKENS_EXHAUSTED');
});

test('standalone assistants retain provider failure behavior without an unused native tool context', async () => {
  const assistant = new AiAssistantService({ config: { ...DEFAULT_AI_SETTINGS, ...config } });
  await assert.rejects(assistant.chat({ authMethod: 'session',
    accountability: createAccountability({ user: 'standalone-user', role: 'normal-role' }) },
  { messages: [{ role: 'user', content: 'No native tool context is needed for this provider failure.' }] }), error => {
    // The real reserved DNS name cannot provide a completion; no fetch/service
    // replacement is used to check the pre-existing no-emitter entry path.
    assert.ok(['AI_PROVIDER_UNAVAILABLE', 'AI_PROVIDER_TIMEOUT'].includes(error.code), error.message);
    return true;
  });
});
