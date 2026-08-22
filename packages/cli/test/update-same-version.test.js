import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { runUpdateCommand } from '../src/update-command.js';

const env = { DB_DATABASE: 'yuncms_test', DB_USER: 'yuncms', DB_PASSWORD: 'secret', PORT: '3008' };
const output = { log() {}, warn() {}, error() {} };
const fakeLock = async () => ({ async assertHeld() { return true; }, async release() {} });
const fakeProjectLock = async () => ({ bypassToken: 'a'.repeat(64), async release() {} });

async function backupFixture(cwd) {
  const backupPath = join(cwd, 'backup');
  await mkdir(backupPath, { recursive: true });
  const manifest = {
    format: 1,
    complete: true,
    createdAt: '2026-08-22T09:00:00.000Z',
    database: {
      host: '127.0.0.1', port: 3306, database: 'yuncms_test', user: 'yuncms', ssl: false,
      verifiedDecompressedBytes: 1,
    },
    project: {
      env: false, packageJson: false, packageLock: false, extensions: false, localFiles: false,
      localFilesRoot: '.yuncms/uploads',
    },
    s3: { configured: false, bucket: null, objectsBackedUp: false },
  };
  await writeFile(join(backupPath, 'manifest.json'), `${JSON.stringify(manifest)}\n`);
  await writeFile(join(backupPath, 'database.sql.gz'), 'x');
  return { backupPath, manifest };
}

test('same package version with clean database is a no-op', async () => {
  let backupCalled = false;
  const result = await runUpdateCommand({
    args: ['--to', '1.0.0'],
    cwd: '/srv/yuncms',
    env,
    output,
    acquireLock: fakeProjectLock,
    acquireMaintenanceLock: fakeLock,
    async collectPreflight() {
      return {
        currentVersion: '1.0.0', targetVersion: '1.0.0', dependencySection: 'dependencies', upToDate: true,
        pendingMigrations: [], unknownAppliedMigrations: [], migrationHistoryGap: [], incompleteMigrationAttempts: [],
        databaseBytes: 1, freeDiskBytes: 999999999, s3Configured: false, blockers: [],
      };
    },
    async createBackup() { backupCalled = true; },
  });
  assert.equal(result.changed, false);
  assert.equal(backupCalled, false);
});

test('same package version with pending migration backs up and bootstraps without npm reinstall', async () => {
  const cwd = await mkdtemp(join(tmpdir(), 'yuncms-same-version-pending-'));
  try {
    const backup = await backupFixture(cwd);
    const events = [];
    let probeToken = null;
    const result = await runUpdateCommand({
      args: ['--to', '1.0.0'],
      cwd,
      env,
      output,
      acquireLock: fakeProjectLock,
      acquireMaintenanceLock: fakeLock,
      async assertStopped() { return true; },
      async collectPreflight() {
        return {
          currentVersion: '1.0.0', targetVersion: '1.0.0', dependencySection: 'dependencies', upToDate: true,
          pendingMigrations: ['0013'], unknownAppliedMigrations: [], migrationHistoryGap: [], incompleteMigrationAttempts: [],
          databaseBytes: 1, freeDiskBytes: 999999999, s3Configured: false, blockers: [],
        };
      },
      async createBackup() { events.push('backup'); return backup; },
      async runProcess(command, args) {
        events.push(args.includes('bootstrap') ? 'bootstrap' : `unexpected:${command}`);
        return { stdout: '', stderr: '', code: 0 };
      },
      async verifyRuntime(options) {
        events.push('probe');
        probeToken = options.maintenanceBypassToken;
        return { ready: true };
      },
    });
    assert.equal(result.changed, true);
    assert.deepEqual(events, ['backup', 'bootstrap', 'probe']);
    assert.equal(probeToken, 'a'.repeat(64));
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test('same package version with incomplete migration attempt fails before backup', async () => {
  let backupCalled = false;
  await assert.rejects(
    runUpdateCommand({
      args: ['--to', '1.0.0'],
      cwd: '/srv/yuncms',
      env,
      output,
      acquireLock: fakeProjectLock,
      acquireMaintenanceLock: fakeLock,
      async collectPreflight() {
        return {
          currentVersion: '1.0.0', targetVersion: '1.0.0', dependencySection: 'dependencies', upToDate: true,
          pendingMigrations: [], unknownAppliedMigrations: [], migrationHistoryGap: [],
          incompleteMigrationAttempts: [{ migration_id: '0013', status: 'failed' }],
          databaseBytes: 1, freeDiskBytes: 999999999, s3Configured: false,
          blockers: ['UPDATE_MIGRATION_RECOVERY_REQUIRED'],
        };
      },
      async createBackup() { backupCalled = true; },
    }),
    (error) => error.code === 'UPDATE_PREFLIGHT_FAILED'
      && error.blockers.includes('UPDATE_MIGRATION_RECOVERY_REQUIRED'),
  );
  assert.equal(backupCalled, false);
});
