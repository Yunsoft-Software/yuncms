import assert from 'node:assert/strict';
import test from 'node:test';

import { runRestoreCommand } from '../src/restore-command.js';

const env = {
  DB_DATABASE: 'yuncms_test',
  DB_USER: 'yuncms',
  DB_PASSWORD: 'secret',
  HOST: '0.0.0.0',
  PORT: '3008',
};

function fakeLock(events) {
  return {
    async release() { events.push('unlock'); },
  };
}

function fakeMaintenanceLock(events) {
  return {
    async release() { events.push('db-unlock'); },
  };
}

test('manual restore checks service state before acquiring database maintenance lock', async () => {
  const events = [];
  await assert.rejects(
    runRestoreCommand({
      args: ['./backup', '--yes'],
      cwd: '/srv/yuncms',
      env,
      output: { log() {} },
      async acquireLock() { events.push('lock'); return fakeLock(events); },
      async acquireMaintenanceLock() { events.push('db-lock'); return fakeMaintenanceLock(events); },
      async assertStopped(options) {
        events.push(`stopped:${options.host}:${options.port}`);
        const error = new Error('running');
        error.code = 'UPDATE_APPLICATION_RUNNING';
        throw error;
      },
      async restoreBackup() { events.push('restore'); },
    }),
    (error) => error.code === 'UPDATE_APPLICATION_RUNNING',
  );

  assert.deepEqual(events, ['lock', 'stopped:0.0.0.0:3008', 'unlock']);
});

test('manual restore holds database lock and passes a second stopped-service guard before destructive reset', async () => {
  const events = [];
  await runRestoreCommand({
    args: ['./backup', '--yes'],
    cwd: '/srv/yuncms',
    env,
    output: { log() {} },
    async acquireLock() { events.push('lock'); return fakeLock(events); },
    async acquireMaintenanceLock() { events.push('db-lock'); return fakeMaintenanceLock(events); },
    async assertStopped() { events.push('stopped'); return true; },
    async restoreBackup(options) {
      events.push('restore-validate');
      await options.beforeDestructive();
      events.push('restore-reset');
      return { ok: true };
    },
  });

  assert.deepEqual(events, [
    'lock',
    'stopped',
    'db-lock',
    'stopped',
    'restore-validate',
    'stopped',
    'restore-reset',
    'db-unlock',
    'unlock',
  ]);
});
