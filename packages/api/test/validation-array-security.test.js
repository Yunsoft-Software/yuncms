import assert from 'node:assert/strict';
import test from 'node:test';
import { z } from 'zod/v4';

test('oversized arrays reject before allocating an issue for every element', () => {
  const result = z.array(z.string()).max(2).safeParse(Array.from({ length: 1000 }, () => 1));
  assert.equal(result.success, false);
  assert.equal(result.error.issues.length, 1);
  assert.equal(result.error.issues[0].code, 'too_big');
});
