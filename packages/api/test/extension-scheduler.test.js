import assert from 'node:assert/strict';
import test from 'node:test';

import {
  cronMatches,
  ExtensionScheduler,
  parseCronExpression,
} from '../src/extensions/scheduler.js';

function runtimeOptions(overrides = {}) {
  return {
    database: {},
    services: {},
    schemaCache: { async get() { return { collections: {} }; } },
    emitter: {},
    logger: { info() {}, warn() {}, error() {} },
    env: {},
    ...overrides,
  };
}

test('cron parser accepts bounded five-field syntax and rejects invalid ranges', () => {
  const parsed = parseCronExpression('*/15 8-10 * * 1,3,5');
  assert.equal(cronMatches(parsed, new Date(2026, 7, 24, 8, 30)), true);
  assert.equal(cronMatches(parsed, new Date(2026, 7, 24, 8, 31)), false);
  assert.throws(() => parseCronExpression('* * * *'), /exactly 5 fields/);
  assert.throws(() => parseCronExpression('60 * * * *'), /minute must be between/);
});

test('scheduled jobs require explicit system accountability and stable ids', () => {
  const scheduler = new ExtensionScheduler(runtimeOptions());
  assert.throws(
    () => scheduler.register('demo', '* * * * *', async () => {}, { id: 'job' }),
    /accountability: 'system'/,
  );
  assert.throws(
    () => scheduler.register('demo', '* * * * *', async () => {}, { id: 'bad id', accountability: 'system' }),
    /stable id/,
  );
});

test('scheduler skips overlap and does not execute same job twice in one minute', async () => {
  let resolveRun;
  let calls = 0;
  const scheduler = new ExtensionScheduler(runtimeOptions());
  scheduler.register('demo', '* * * * *', async () => {
    calls += 1;
    await new Promise((resolve) => { resolveRun = resolve; });
  }, { id: 'hourly', accountability: 'system' });

  const when = new Date(2026, 7, 22, 18, 40, 0);
  const first = scheduler.runDue(when);
  await new Promise((resolve) => setImmediate(resolve));
  const duplicate = await scheduler.runDue(when);
  assert.deepEqual(duplicate, []);
  assert.equal(calls, 1);
  resolveRun();
  await first;
});

test('singleton jobs use a zero-wait advisory lock and receive explicit system service options', async () => {
  let lock = null;
  let context = null;
  const scheduler = new ExtensionScheduler(runtimeOptions({
    lockRunner: async (database, name, operation, options) => {
      lock = { database, name, options };
      return operation({});
    },
  }));
  scheduler.register('demo', '* * * * *', async (value) => {
    context = value;
  }, {
    id: 'singleton-job',
    mode: 'singleton',
    accountability: 'system',
  });

  await scheduler.runDue(new Date(2026, 7, 22, 18, 45, 0));
  assert.match(lock.name, /^yuncms:schedule:demo:singleton-job$/);
  assert.equal(lock.options.timeoutSeconds, 0);
  assert.equal(context.accountability.system, true);
  const options = await context.serviceOptions();
  assert.equal(options.accountability.system, true);
  assert.match(options.requestId, /^schedule:demo:singleton-job:/);
});
