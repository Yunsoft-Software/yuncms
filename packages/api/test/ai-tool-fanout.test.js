import assert from 'node:assert/strict';
import test from 'node:test';

import { normalizeToolCalls } from '../src/ai/service.js';

function call(index) {
  return {
    id: `call-${index}`,
    type: 'function',
    function: { name: 'schema_list_collections', arguments: '{}' },
  };
}

test('AI provider tool calls are bounded per round', () => {
  assert.equal(normalizeToolCalls([call(1), call(2)], 2).length, 2);
  assert.throws(
    () => normalizeToolCalls([call(1), call(2), call(3)], 2),
    (error) => error.code === 'AI_TOOL_CALL_LIMIT',
  );
});
