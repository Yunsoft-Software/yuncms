import assert from 'node:assert/strict';
import { test } from 'node:test';

test('an authenticated Studio tab answers only matching same-origin session requests', async () => {
  const original = {
    window: globalThis.window,
    sessionStorage: globalThis.sessionStorage,
    BroadcastChannel: globalThis.BroadcastChannel,
  };
  const listeners = new Set();
  class Channel {
    constructor(name) { this.name = name; }
    addEventListener(_event, listener) { listeners.add(listener); }
    postMessage(message) { messages.push(message); }
  }
  const messages = [];
  globalThis.window = { location: { origin: 'https://factory.example.test' } };
  globalThis.BroadcastChannel = Channel;
  globalThis.sessionStorage = {
    getItem: () => JSON.stringify({ access_token: 'access', refresh_token: 'refresh' }),
  };

  try {
    await import(`../src/api.js?session-relay=${Date.now()}`);
    assert.equal(listeners.size, 1);
    const [listener] = listeners;
    listener({ data: { type: 'unrelated', requestId: 'one' } });
    assert.equal(messages.length, 0);
    listener({ data: { type: 'session-request', requestId: 'one' } });
    assert.deepEqual(messages, [{
      type: 'session-response',
      requestId: 'one',
      session: { access_token: 'access', refresh_token: 'refresh' },
    }]);
  } finally {
    globalThis.window = original.window;
    globalThis.sessionStorage = original.sessionStorage;
    globalThis.BroadcastChannel = original.BroadcastChannel;
  }
});
