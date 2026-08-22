import assert from 'node:assert/strict';
import { access, mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { runBackupCommand } from '../src/backup-command.js';
import {
  acquireDatabaseMaintenanceLock,
  databaseMaintenanceLockName,
} from '../src/maintenance-lock.js';

const env = {
  DB_HOST: '127.0.0.1',
  DB_PORT: '3306',
  DB_DATABASE: 'yuncms_test',
  DB_USER: 'yuncms',
  DB_PASSWORD: 'secret',
  HOST: '127.0.0.1',
  PORT: '3008',
};

test('database maintenance lock name is stable per database without exposing the database name', () => {
  const first = databaseMaintenanceLockName('customer-production-db');
  const second = databaseMaintenanceLockName('customer-production-db');
  const other = databaseMaintenanceLockName('other-db');

  assert.equal(first, second);
  assert.notEqual(first, other);
  assert.match(first, /^yuncms:maintenance:[0-9a-f]{32}$/);
  assert.equal(first.includes('customer-production-db'), false);
});

test('database maintenance lock verifies ownership until explicit release', async () => {
  const calls = [];
  let connectionReleased = false;
  let poolClosed = false;
  const connection = {
    async query(sql, params) {
      calls.push({ sql, params });
      if (sql.startsWith('SELECT GET_LOCK')) return [[{ acquired: 1, connection_id: 42 }], []];
      if (sql.startsWith('SELECT IS_USED_LOCK')) return [[{ connection_id: 42 }], []];
      if (sql.startsWith('SELECT RELEASE_LOCK')) return [[{ released: 1 }], []];
      throw new Error(`Unexpected query: ${sql}`);
    },
    release() { connectionReleased = true; },
  };
  const pool = { async getConnection() { return connection; } };

  const lock = await acquireDatabaseMaintenanceLock({
    env,
    createPool: () => pool,
    async closePool() { poolClosed = true; },
  });

  assert.equal(connectionReleased, false);
  assert.equal(poolClosed, false);
  assert.match(lock.name, /^yuncms:maintenance:/);
  assert.equal(calls[0].params[1], 0);
  assert.equal(await lock.assertHeld(), true);

  await lock.release();
  assert.equal(connectionReleased, true);
  assert.equal(poolClosed, true);
  assert.equal(calls.at(-1).sql, 'SELECT RELEASE_LOCK(?) AS released');
  await assert.rejects(lock.assertHeld(), (error) => error.code === 'DATABASE_MAINTENANCE_LOCK_LOST');

  await lock.release();
  assert.equal(calls.filter(({ sql }) => sql.startsWith('SELECT RELEASE_LOCK')).length, 1);
});

test('database maintenance lock fails closed when ownership is lost', async () => {
  const connection = {
    async query(sql) {
      if (sql.startsWith('SELECT GET_LOCK')) return [[{ acquired: 1, connection_id: 42 }], []];
      if (sql.startsWith('SELECT IS_USED_LOCK')) return [[{ connection_id: 99 }], []];
      if (sql.startsWith('SELECT RELEASE_LOCK')) return [[{ released: 0 }], []];
      throw new Error(`Unexpected query: ${sql}`);
    },
    release() {},
  };
  const pool = { async getConnection() { return connection; } };
  const lock = await acquireDatabaseMaintenanceLock({ env, createPool: () => pool, async closePool() {} });
  try {
    await assert.rejects(lock.assertHeld(), (error) => error.code === 'DATABASE_MAINTENANCE_LOCK_LOST');
  } finally {
    await lock.release();
  }
});

test('unavailable database maintenance lock fails closed and cleans its connection', async () => {
  let connectionReleased = false;
  let poolClosed = false;
  const connection = {
    async query(sql) {
      if (sql.startsWith('SELECT GET_LOCK')) return [[{ acquired: 0, connection_id: 43 }], []];
      throw new Error(`Unexpected query: ${sql}`);
    },
    release() { connectionReleased = true; },
  };
  const pool = { async getConnection() { return connection; } };

  await assert.rejects(
    acquireDatabaseMaintenanceLock({
      env,
      createPool: () => pool,
      async closePool() { poolClosed = true; },
    }),
    (error) => error.code === 'DATABASE_MAINTENANCE_LOCK_UNAVAILABLE'
      && error.database === 'yuncms_test',
  );

  assert.equal(connectionReleased, true);
  assert.equal(poolClosed, true);
});

test('backup holds project and database locks across snapshot creation and final revalidation', async () => {
  const events = [];
  const result = await runBackupCommand({
    args: ['--output', './backup'],
    cwd: '/srv/yuncms',
    env,
    output: { log() {}, warn() {} },
    async assertStopped() { events.push('stopped'); return true; },
    async acquireProjectLock() {
      events.push('project-lock');
      return { async release() { events.push('project-unlock'); } };
    },
    async acquireMaintenanceLock() {
      events.push('db-lock');
      return {
        async assertHeld() { events.push('db-held'); return true; },
        async release() { events.push('db-unlock'); },
      };
    },
    async createBackup(options) {
      events.push('backup');
      assert.equal(options.backupPath, '/srv/yuncms/backup');
      return { ok: true };
    },
  });

  assert.deepEqual(result, { ok: true });
  assert.deepEqual(events, [
    'stopped',
    'project-lock',
    'db-lock',
    'stopped',
    'db-held',
    'backup',
    'stopped',
    'db-held',
    'db-unlock',
    'project-unlock',
  ]);
});

test('backup is discarded if database maintenance ownership is lost before completion is returned', async () => {
  const cwd = await mkdtemp(join(tmpdir(), 'yuncms-backup-lock-loss-'));
  const backupPath = join(cwd, 'snapshot');
  let heldChecks = 0;
  try {
    await assert.rejects(
      runBackupCommand({
        args: ['--output', backupPath],
        cwd,
        env,
        output: { log() {}, warn() {} },
        async assertStopped() { return true; },
        async acquireProjectLock() { return { async release() {} }; },
        async acquireMaintenanceLock() {
          return {
            async assertHeld() {
              heldChecks += 1;
              if (heldChecks === 1) return true;
              const error = new Error('lost');
              error.code = 'DATABASE_MAINTENANCE_LOCK_LOST';
              throw error;
            },
            async release() {},
          };
        },
        async createBackup() {
          await mkdir(backupPath, { recursive: true });
          return { backupPath };
        },
      }),
      (error) => error.code === 'DATABASE_MAINTENANCE_LOCK_LOST'
        && error.backupDiscarded === true,
    );

    await assert.rejects(access(backupPath), (error) => error.code === 'ENOENT');
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});
