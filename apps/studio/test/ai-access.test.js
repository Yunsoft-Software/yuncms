import assert from 'node:assert/strict';
import test from 'node:test';

import { AI_ACCESS_MODES, aiAccessFlags } from '../src/ai-access.js';

test('Studio AI access modes map to independent write and delete consent', () => {
  assert.deepEqual(aiAccessFlags(AI_ACCESS_MODES.READ), {
    allowWrites: false,
    allowDeletes: false,
  });
  assert.deepEqual(aiAccessFlags(AI_ACCESS_MODES.WRITE), {
    allowWrites: true,
    allowDeletes: false,
  });
  assert.deepEqual(aiAccessFlags(AI_ACCESS_MODES.FULL), {
    allowWrites: true,
    allowDeletes: true,
  });
  assert.deepEqual(aiAccessFlags('unexpected'), {
    allowWrites: false,
    allowDeletes: false,
  });
});
