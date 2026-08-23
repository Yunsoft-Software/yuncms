import assert from 'node:assert/strict';
import test from 'node:test';

import { trimConversationHistory } from '../src/ai-history.js';

test('AI conversation history stays within the server-advertised limit', () => {
  const messages = [
    { role: 'user', content: 'u1' },
    { role: 'assistant', content: 'a1' },
    { role: 'user', content: 'u2' },
    { role: 'assistant', content: 'a2' },
    { role: 'user', content: 'u3' },
  ];
  assert.deepEqual(trimConversationHistory(messages, 3), [
    { role: 'user', content: 'u2' },
    { role: 'assistant', content: 'a2' },
    { role: 'user', content: 'u3' },
  ]);
});

test('AI history never starts with an orphaned assistant turn', () => {
  const messages = [
    { role: 'user', content: 'u1' },
    { role: 'assistant', content: 'a1' },
    { role: 'user', content: 'u2' },
    { role: 'assistant', content: 'a2' },
    { role: 'user', content: 'u3' },
  ];
  assert.deepEqual(trimConversationHistory(messages, 4), [
    { role: 'user', content: 'u2' },
    { role: 'assistant', content: 'a2' },
    { role: 'user', content: 'u3' },
  ]);
});

test('AI history uses a safe fallback for invalid limits', () => {
  const messages = Array.from({ length: 24 }, (_, index) => ({
    role: index % 2 === 0 ? 'user' : 'assistant',
    content: String(index),
  }));
  const result = trimConversationHistory(messages, 0);
  assert.ok(result.length <= 20);
  assert.equal(result[0].role, 'user');
});
