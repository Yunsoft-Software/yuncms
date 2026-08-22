import assert from 'node:assert/strict';
import test from 'node:test';

import { HookEmitter } from '../src/hooks.js';

test('hook filters run by priority, extension id and registration order', async () => {
  const emitter = new HookEmitter();
  const order = [];
  emitter.registerFilter('items.query', (value) => { order.push('later'); return value; }, { priority: -1, extensionId: 'z' });
  emitter.registerFilter('items.query', (value) => { order.push('b'); return value; }, { priority: 10, extensionId: 'b' });
  emitter.registerFilter('items.query', (value) => { order.push('a'); return value; }, { priority: 10, extensionId: 'a' });

  await emitter.filter('items.query', {});
  assert.deepEqual(order, ['a', 'b', 'later']);
});

test('post-commit action failures are logged instead of escaping', async () => {
  const errors = [];
  const emitter = new HookEmitter({ logger: { error: (...args) => errors.push(args) } });
  emitter.registerAction('items.create', async () => {
    throw Object.assign(new Error('external side effect failed'), { code: 'SIDE_EFFECT_FAILED' });
  }, { extensionId: 'broken-hook' });

  await emitter.action('items.create', { key: '1' });
  assert.equal(errors.length, 1);
  assert.equal(errors[0][1].extensionId, 'broken-hook');
});

test('hook chain metadata is isolated and bounded', async () => {
  const emitter = new HookEmitter({ maxDepth: 2 });
  let seen;
  emitter.registerFilter('outer', async (value, context) => {
    seen = context.hook;
    await emitter.filter('inner', value);
    return value;
  });

  await emitter.filter('outer', {});
  assert.equal(seen.depth, 1);
  assert.deepEqual(seen.stack, ['outer']);
  assert.ok(seen.chainId);
});
