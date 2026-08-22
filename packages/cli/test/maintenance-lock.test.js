import assert from 'node:assert/strict';
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

test('database maintenance lock holds one MySQL connection until explicit release', async () => {
  const calls = [];
  let connectionReleased = false;
  let poolClosed = false;
  const connection = {
    async query(sql, params) {
      calls.push({ sql, params });
      if (sql.startsWith('SELECT GET_LOCK')) return [[{ acquired: 1 }], []];
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

  await lock.release();
  assert.equal(connectionReleased, true);
  assert.equal(poolClosed, true);
  assert.equal(calls.at(-1).sql, 'SELECT RELEASE_LOCK(?) AS released');

  await lock.release();
  assert.equal(calls.filter(({ sql }) => sql.startsWith('SELECT RELEASE_LOCK')).length, 1);
});

test('unavailable database maintenance lock fails closed and cleans its connection', async () => {
  let connectionReleased = false;
  let poolClosed = false;
  const connection = {
    async query(sql) {
      if (sql.startsWith('SELECT GET_LOCK')) return [[{ acquired: 0 }], []];
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

test('backup holds project and database locks across snapshot creation and releases them in reverse order', async () => {
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
      return { async release() { events.push('db-unlock'); } };
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
    'backup',
    'db-unlock',
    'project-unlock',
  ]);
});
