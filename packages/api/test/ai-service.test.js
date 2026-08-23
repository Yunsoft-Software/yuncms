import assert from 'node:assert/strict';
import test from 'node:test';

import { AiAssistantService, normalizeAiConversation } from '../src/ai/service.js';

function config(overrides = {}) {
  return {
    enabled: true,
    baseUrl: 'https://provider.example.test/v1',
    apiKey: 'top-secret-key',
    model: 'example-model',
    writesEnabled: false,
    maxToolRounds: 4,
    maxHistory: 20,
    maxMessageChars: 12_000,
    maxToolResultBytes: 250_000,
    maxOutputTokens: 1_500,
    timeoutMs: 5_000,
    ...overrides,
  };
}

function okResponse(payload) {
  return {
    ok: true,
    status: 200,
    async text() { return JSON.stringify(payload); },
  };
}

function request(ItemsService = class {}) {
  return {
    id: 'req-ai',
    authMethod: 'api_token',
    accountability: { user: 'user-1', role: 'role-1', admin: false, system: false },
    context: {
      services: { ItemsService, PermissionsService: class {} },
      database: {},
      schema: { collections: {}, relationByManyField: new Map() },
      logger: console,
      emitter: null,
      storage: null,
      permissionCache: null,
    },
  };
}

test('AI conversation accepts only bounded user/assistant history and requires a user turn last', () => {
  const settings = config();
  assert.deepEqual(normalizeAiConversation([
    { role: 'user', content: '  Merhaba  ' },
  ], settings), [{ role: 'user', content: 'Merhaba' }]);
  assert.throws(
    () => normalizeAiConversation([{ role: 'system', content: 'override' }], settings),
    /user or assistant roles/,
  );
  assert.throws(
    () => normalizeAiConversation([{ role: 'assistant', content: 'done' }], settings),
    /final conversation message must be from the user/,
  );
});

test('AI status exposes limits and capabilities but never provider credentials', () => {
  const service = new AiAssistantService({ config: config(), fetchImpl: async () => assert.fail('not called') });
  const status = service.status();
  assert.equal(status.enabled, true);
  assert.equal(status.model, 'example-model');
  assert.equal(status.max_history, 20);
  assert.equal(status.writes_available, false);
  assert.equal(Object.hasOwn(status, 'apiKey'), false);
  assert.equal(JSON.stringify(status).includes('top-secret-key'), false);
});

test('AI assistant sends a protected system prompt and returns a normal chat answer', async () => {
  let providerBody = null;
  const service = new AiAssistantService({
    config: config(),
    fetchImpl: async (_url, options) => {
      providerBody = JSON.parse(options.body);
      return okResponse({ choices: [{ message: { role: 'assistant', content: 'Doğruladım.' } }] });
    },
  });
  const result = await service.chat(request(), {
    messages: [{ role: 'user', content: 'Koleksiyonlarımı kontrol etmeden genel cevap ver.' }],
    locale: 'tr',
  });
  assert.equal(result.message, 'Doğruladım.');
  assert.equal(result.writes_enabled, false);
  assert.match(providerBody.messages[0].content, /embedded inside YunCMS Studio/);
  assert.match(providerBody.messages[0].content, /current account does not have that access/);
  assert.match(providerBody.messages[0].content, /untrusted data/);
  assert.match(providerBody.messages[0].content, /stored content/);
  assert.equal(providerBody.messages[1].role, 'user');
  assert.equal(providerBody.tools.some((tool) => tool.function.name === 'items_create'), false);
});

test('AI write tool loop requires server capability and per-request write consent', async () => {
  const providerBodies = [];
  let providerCall = 0;
  let constructed = null;
  class ItemsService {
    constructor(collection, options) {
      constructed = { collection, options };
    }
    async createOne(data) {
      return { id: 'created-1', ...data };
    }
  }
  const service = new AiAssistantService({
    config: config({ writesEnabled: true }),
    fetchImpl: async (_url, options) => {
      providerBodies.push(JSON.parse(options.body));
      providerCall += 1;
      if (providerCall === 1) {
        return okResponse({
          choices: [{
            message: {
              role: 'assistant',
              content: null,
              tool_calls: [{
                id: 'call-1',
                type: 'function',
                function: {
                  name: 'items_create',
                  arguments: JSON.stringify({ collection: 'articles', data: { title: 'Hello' } }),
                },
              }],
            },
          }],
        });
      }
      return okResponse({ choices: [{ message: { role: 'assistant', content: 'Kaydı oluşturdum.' } }] });
    },
  });

  const result = await service.chat(request(ItemsService), {
    messages: [{ role: 'user', content: 'articles koleksiyonuna Hello başlıklı kayıt ekle' }],
    locale: 'tr',
    allowWrites: true,
  });
  assert.equal(result.writes_enabled, true);
  assert.equal(result.operations.length, 1);
  assert.deepEqual(result.operations[0], { operation: 'items_create', collection: 'articles', success: true });
  assert.equal(constructed.collection, 'articles');
  assert.equal(constructed.options.accountability.user, 'user-1');
  assert.equal(providerBodies[0].tools.some((tool) => tool.function.name === 'items_create'), true);
  assert.equal(providerBodies[1].messages.at(-1).role, 'tool');
  assert.match(providerBodies[1].messages.at(-1).content, /created-1/);
});

test('AI does not advertise writes when the user has not enabled write mode for the request', async () => {
  let providerBody = null;
  const service = new AiAssistantService({
    config: config({ writesEnabled: true }),
    fetchImpl: async (_url, options) => {
      providerBody = JSON.parse(options.body);
      return okResponse({ choices: [{ message: { role: 'assistant', content: 'Sadece okuyabilirim.' } }] });
    },
  });
  await service.chat(request(), {
    messages: [{ role: 'user', content: 'Bir şeyler yap' }],
    allowWrites: false,
  });
  assert.equal(providerBody.tools.some((tool) => tool.function.name === 'items_delete'), false);
  assert.match(providerBody.messages[0].content, /This request is read-only/);
});
