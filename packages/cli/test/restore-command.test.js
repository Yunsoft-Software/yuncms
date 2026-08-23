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
  return { async release() { events.push('unlock'); } };
}

function fakeMaintenanceLock(events) {
  return {
    async assertHeld() { events.push('db-held'); return true; },
    async release() { events.push('db-unlock'); },
  };
}

test('manual restore checks service state before acquiring database maintenance lock', async () => {
  const events = [];
  await assert.rejects(
    runRestoreCommand({
      args: ['./backup', '--yes'], cwd: '/srv/yuncms', env, output: { log() {} },
      async acquireLock() { events.push('lock'); return fakeLock(events); },
      async acquireMaintenanceLock() { events.push('db-lock'); return fakeMaintenanceLock(events); },
      async assertStopped(options) {
        events.push(`stopped:${options.host}:${options.port}`);
        const error = new Error('running'); error.code = 'UPDATE_APPLICATION_RUNNING'; throw error;
      },
      async restoreBackup() { events.push('restore'); },
    }),
    (error) => error.code === 'UPDATE_APPLICATION_RUNNING',
  );
  assert.deepEqual(events, ['lock', 'stopped:0.0.0.0:3008', 'unlock']);
});

test('manual restore holds database lock and rechecks ownership before destructive reset', async () => {
  const events = [];
  await runRestoreCommand({
    args: ['./backup', '--yes'], cwd: '/srv/yuncms', env, output: { log() {} },
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
    'lock', 'stopped', 'db-lock', 'stopped', 'db-held', 'restore-validate',
    'stopped', 'db-held', 'restore-reset', 'db-unlock', 'unlock',
  ]);
});

test('manual restore tells operators to reinstall the restored dependency graph', async () => {
  const warnings = [];
  const events = [];
  const restored = await runRestoreCommand({
    args: ['./backup', '--yes'], cwd: '/srv/yuncms', env,
    output: { log() {}, warn(message) { warnings.push(message); } },
    async acquireLock() { return fakeLock(events); },
    async acquireMaintenanceLock() { return fakeMaintenanceLock(events); },
    async assertStopped() { return true; },
    async restoreBackup() {
      return { manifest: { project: { packageJson: true, packageLock: true } } };
    },
  });

  assert.equal(restored.manifest.project.packageLock, true);
  assert.deepEqual(warnings, [
    'Project package files were restored. Run npm ci before starting YunCMS so node_modules matches the restored lockfile.',
  ]);
});
