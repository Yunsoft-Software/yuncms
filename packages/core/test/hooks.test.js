import test from 'node:test';
import assert from 'node:assert/strict';

import { HookEmitter } from '../src/hooks.js';

test('filters run in registration order and may transform payload', async () => {
  const emitter = new HookEmitter();
  emitter.registerFilter('items.create', (payload) => ({ ...payload, title: payload.title.trim() }));
  emitter.registerFilter('items.create', (payload) => ({ ...payload, slug: payload.title.toLowerCase() }));

  const result = await emitter.filter('items.create', { title: ' Demo ' });
  assert.deepEqual(result, { title: 'Demo', slug: 'demo' });
});

test('actions receive an async-chain hook id and event stack', async () => {
  const emitter = new HookEmitter();
  let context = null;

  emitter.registerAction('items.update', (_payload, hookContext) => {
    context = hookContext.hook;
  });

  await emitter.action('items.update', { key: '1' });
  assert.equal(typeof context.chainId, 'string');
  assert.equal(context.depth, 1);
  assert.deepEqual(context.events, ['items.update']);
});

test('recursive post-commit actions stop at the chain limit and log the failure', async () => {
  const errors = [];
  const emitter = new HookEmitter({
    maxDepth: 2,
    logger: { error: (...args) => errors.push(args) },
  });
  let executions = 0;
  emitter.registerAction('loop', async () => {
    executions += 1;
    await emitter.action('loop', {});
  });

  await emitter.action('loop', {});

  assert.equal(executions, 2);
  assert.equal(errors.length, 1);
  assert.equal(errors[0][1].code, 'HOOK_RECURSION_LIMIT');
});

test('different async calls do not share recursion state', async () => {
  const emitter = new HookEmitter({ maxDepth: 1 });
  const seen = [];
  emitter.registerAction('independent', (_payload, context) => {
    seen.push(context.hook.chainId);
  });

  await Promise.all([
    emitter.action('independent', { id: 1 }),
    emitter.action('independent', { id: 2 }),
  ]);

  assert.equal(seen.length, 2);
  assert.notEqual(seen[0], seen[1]);
});
