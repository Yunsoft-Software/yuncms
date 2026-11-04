import assert from 'node:assert/strict';
import test from 'node:test';
import { tabTargetIndex } from '../src/tab-navigation.js';

test('horizontal tabs wrap, expose both ends and leave unrelated keys alone', () => {
  assert.equal(tabTargetIndex('ArrowRight', 23, 24), 0);
  assert.equal(tabTargetIndex('ArrowLeft', 0, 24), 23);
  assert.equal(tabTargetIndex('Home', 12, 24), 0);
  assert.equal(tabTargetIndex('End', 12, 24), 23);
  assert.equal(tabTargetIndex('ArrowRight', 0, 1), 0);
  assert.equal(tabTargetIndex('ArrowRight', -1, 24), 1);
  for (const key of ['Tab', 'Enter', 'ArrowDown', 'a']) assert.equal(tabTargetIndex(key, 0, 24), null);
  assert.equal(tabTargetIndex('End', 0, 0), null);
});
