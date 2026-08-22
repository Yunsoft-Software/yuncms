import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { gzipSync } from 'node:zlib';

import { runBackupCommand } from '../src/backup-command.js';
import { parseCommandOptions } from '../src/command-options.js';
import { verifyDatabaseDump } from '../src/database-backup.js';
import {
  assertUpdatePreflightReady,
  compareVersions,
} from '../src/update-preflight.js';

const env = {
  DB_DATABASE: 'yuncms_test',
  DB_USER: 'yuncms',
  DB_PASSWORD: 'secret',
  PORT: '3008',
};

test('strict option parser rejects unknown and duplicate options', () => {
  assert.throws(
    () => parseCommandOptions(['--unknown'], { maxPositionals: 0 }),
    (error) => error.code === 'INVALID_CLI_ARGUMENTS',
  );
  assert.throws(
    () => parseCommandOptions(['--to', '0.2.0', '--to', '0.2.1'], {
      string: ['--to'],
      maxPositionals: 0,
    }),
    (error) => error.code === 'INVALID_CLI_ARGUMENTS',
  );
});

test('version comparison follows semantic version precedence including prereleases', () => {
  assert.equal(compareVersions('0.1.1', '0.1.2'), -1);
  assert.equal(compareVersions('0.2.0', '0.1.9'), 1);
  assert.equal(compareVersions('1.0.0', '1.0.0'), 0);
  assert.equal(compareVersions('1.0.0-beta.2', '1.0.0-beta.11'), -1);
  assert.equal(compareVersions('1.0.0-beta.11', '1.0.0-rc.1'), -1);
  assert.equal(compareVersions('1.0.0-rc.1', '1.0.0'), -1);
  assert.equal(compareVersions('1.0.0', '1.0.0-beta.9'), 1);
  assert.equal(compareVersions('1.0.0+build.1', '1.0.0+build.2'), 0);
  assert.throws(
    () => compareVersions('1.0', '1.0.0'),
    (error) => error.code === 'UPDATE_VERSION_INVALID',
  );
});

test('preflight blocker set fails closed before backup/update mutation', () => {
  const report = {
    blockers: [
      'UPDATE_APPLICATION_RUNNING',
      'UPDATE_MIGRATION_HISTORY_INCOMPATIBLE',
    ],
  };
  assert.throws(
    () => assertUpdatePreflightReady(report),
    (error) => error.code === 'UPDATE_PREFLIGHT_FAILED'
      && error.blockers.includes('UPDATE_APPLICATION_RUNNING')
      && error.blockers.includes('UPDATE_MIGRATION_HISTORY_INCOMPATIBLE'),
  );
});

test('backup checks stopped service before creating any snapshot state', async () => {
  let backupCalled = false;
  await assert.rejects(
    runBackupCommand({
      args: [],
      cwd: '/srv/yuncms',
      env,
      output: { log() {}, warn() {} },
      async assertStopped() {
        const error = new Error('running');
        error.code = 'UPDATE_APPLICATION_RUNNING';
        throw error;
      },
      async createBackup() {
        backupCalled = true;
      },
    }),
    (error) => error.code === 'UPDATE_APPLICATION_RUNNING',
  );
  assert.equal(backupCalled, false);
});

test('database backup verification accepts valid gzip and rejects corrupt/empty dumps', async () => {
  const cwd = await mkdtemp(join(tmpdir(), 'yuncms-dump-verify-'));
  try {
    const valid = join(cwd, 'valid.sql.gz');
    const corrupt = join(cwd, 'corrupt.sql.gz');
    const empty = join(cwd, 'empty.sql.gz');
    await writeFile(valid, gzipSync(Buffer.from('CREATE TABLE example (id INT);\n')));
    await writeFile(corrupt, Buffer.from('not-gzip'));
    await writeFile(empty, gzipSync(Buffer.alloc(0)));

    const verified = await verifyDatabaseDump({ inputPath: valid });
    assert.ok(verified.decompressedBytes > 0);
    await assert.rejects(
      verifyDatabaseDump({ inputPath: corrupt }),
      (error) => error.code === 'BACKUP_DATABASE_INVALID',
    );
    await assert.rejects(
      verifyDatabaseDump({ inputPath: empty }),
      (error) => error.code === 'BACKUP_DATABASE_EMPTY',
    );
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});
