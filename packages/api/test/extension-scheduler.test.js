import assert from 'node:assert/strict';
import test from 'node:test';

import {
  cronMatches,
  ExtensionScheduler,
  parseCronExpression,
  resolveSchedulerConcurrency,
  scheduleLockName,
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

test('singleton jobs use a bounded zero-wait advisory lock and receive explicit system service options', async () => {
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
  assert.equal(lock.name, scheduleLockName('demo:singleton-job'));
  assert.match(lock.name, /^yuncms:schedule:[a-f0-9]{40}$/);
  assert.ok(Buffer.byteLength(lock.name, 'utf8') <= 64);
  assert.equal(lock.options.timeoutSeconds, 0);
  assert.equal(context.accountability.system, true);
  const options = await context.serviceOptions();
  assert.equal(options.accountability.system, true);
  assert.match(options.requestId, /^schedule:demo:singleton-job:/);
  assert.equal(options.authConfig?.totpKey, null);
});

test('scheduler lock names stay bounded even for maximum extension and job identities', () => {
  const name = scheduleLockName(`${'extension'.repeat(20)}:${'j'.repeat(100)}`);
  assert.ok(Buffer.byteLength(name, 'utf8') <= 64);
  assert.equal(name, scheduleLockName(`${'extension'.repeat(20)}:${'j'.repeat(100)}`));
});

test('singleton jobs reuse the borrowed advisory-lock connection for schemaCache, context.database and serviceOptions', async () => {
  const pool = { id: 'pool', pool: { config: { connectionLimit: 3 } } };
  const lockConnection = { id: 'lock-connection', query: async () => [[], []] };
  const schemaHandles = [];
  let capturedContext = null;

  const scheduler = new ExtensionScheduler(runtimeOptions({
    database: pool,
    schemaCache: {
      async get(db) {
        schemaHandles.push(db);
        return { collections: {}, boundTo: db.id };
      },
    },
    lockRunner: async (database, _name, operation) => {
      assert.equal(database, pool);
      return operation(lockConnection);
    },
  }));

  scheduler.register('demo', '* * * * *', async (ctx) => {
    capturedContext = ctx;
    assert.equal(ctx.database, lockConnection);
    assert.equal((await ctx.serviceOptions()).database, lockConnection);
  }, {
    id: 'singleton-conn-reuse',
    mode: 'singleton',
    accountability: 'system',
  });

  await scheduler.runDue(new Date(2026, 9, 23, 12, 0, 0));
  assert.equal(capturedContext.database, pool, 'after singleton schedule finishes, context.database must fall back to pool');
  assert.equal(capturedContext.pool, pool);
  assert.deepEqual(schemaHandles, [lockConnection]);

  const postReleaseOpts = await capturedContext.serviceOptions();
  assert.equal(postReleaseOpts.database, pool, 'after singleton schedule finishes, serviceOptions() must fall back to pool');

  const customConn = { id: 'custom-conn', query: async () => [[], []] };
  const overridden = await capturedContext.serviceOptions({ database: customConn });
  assert.equal(overridden.database, customConn);
  assert.equal(overridden.schema.boundTo, 'custom-conn');
});

test('bounded pool admission serializes concurrent singleton schedules so pool connections remain available', async () => {
  assert.equal(resolveSchedulerConcurrency({ pool: { config: { connectionLimit: 3 } } }, {}), 1);
  assert.equal(resolveSchedulerConcurrency({ pool: { config: { connectionLimit: 5 } } }, {}), 2);
  assert.equal(resolveSchedulerConcurrency({ pool: { config: { connectionLimit: 10 } } }, {}), 4);

  let activeLocks = 0;
  let maxActiveLocks = 0;
  let releaseFirstJob;
  const firstJobStarted = new Promise((resolve) => {
    releaseFirstJob = resolve;
  });
  let unblockFirstJob;
  const firstJobGate = new Promise((resolve) => {
    unblockFirstJob = resolve;
  });

  const pool = { pool: { config: { connectionLimit: 3 } } };
  const scheduler = new ExtensionScheduler(runtimeOptions({
    database: pool,
    lockRunner: async (_db, name, operation) => {
      activeLocks += 1;
      maxActiveLocks = Math.max(maxActiveLocks, activeLocks);
      try {
        return await operation({ lockName: name, query: async () => [[], []] });
      } finally {
        activeLocks -= 1;
      }
    },
  }));

  const order = [];
  scheduler.register('ops', '* * * * *', async (ctx) => {
    order.push(`start:${ctx.schedule.id}`);
    releaseFirstJob();
    await firstJobGate;
    order.push(`end:${ctx.schedule.id}`);
  }, { id: 'dispatch-due-deliveries', mode: 'singleton', accountability: 'system' });

  scheduler.register('ops', '* * * * *', async (ctx) => {
    order.push(`start:${ctx.schedule.id}`);
    order.push(`end:${ctx.schedule.id}`);
  }, { id: 'retention-sweep', mode: 'singleton', accountability: 'system' });

  const duePromise = scheduler.runDue(new Date(2026, 9, 23, 12, 5, 0));
  await firstJobStarted;
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(activeLocks, 1, 'second singleton job must not borrow a second lock connection while pool limit is 3');
  assert.deepEqual(order, ['start:dispatch-due-deliveries']);

  unblockFirstJob();
  const results = await duePromise;
  assert.deepEqual(results, [true, true]);
  assert.equal(maxActiveLocks, 1);
  assert.deepEqual(order, [
    'start:dispatch-due-deliveries',
    'end:dispatch-due-deliveries',
    'start:retention-sweep',
    'end:retention-sweep',
  ]);
});
