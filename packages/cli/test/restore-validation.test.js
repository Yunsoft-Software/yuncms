import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { BACKUP_FORMAT_VERSION, restoreProjectBackup } from '../src/project-backup.js';

const env = {
  DB_HOST: '127.0.0.1',
  DB_PORT: '3306',
  DB_DATABASE: 'yuncms_test',
  DB_USER: 'yuncms',
  DB_PASSWORD: 'secret',
  FILES_LOCAL_ROOT: '.yuncms/uploads',
};

async function writeManifest(backupPath, project = {}) {
  const manifest = {
    format: BACKUP_FORMAT_VERSION,
    complete: true,
    createdAt: '2026-08-22T09:00:00.000Z',
    database: {
      host: '127.0.0.1',
      port: 3306,
      database: 'yuncms_test',
      user: 'yuncms',
      ssl: false,
      verifiedDecompressedBytes: 10,
    },
    project: {
      env: false,
      packageJson: false,
      packageLock: false,
      extensions: false,
      localFiles: false,
      localFilesRoot: '.yuncms/uploads',
      ...project,
    },
    s3: { configured: false, bucket: null, objectsBackedUp: false },
  };
  await writeFile(join(backupPath, 'manifest.json'), `${JSON.stringify(manifest)}\n`);
  return manifest;
}

test('corrupt database backup is rejected before database reset', async () => {
  const cwd = await mkdtemp(join(tmpdir(), 'yuncms-restore-corrupt-'));
  const backupPath = join(cwd, 'backup');
  await mkdir(backupPath);
  try {
    await writeManifest(backupPath);
    await writeFile(join(backupPath, 'database.sql.gz'), 'not-a-gzip');
    let resetCalled = false;

    await assert.rejects(
      restoreProjectBackup({
        backupPath,
        cwd,
        env,
        output: { log() {} },
        async resetDatabaseFn() { resetCalled = true; },
        async restoreDatabaseFn() { throw new Error('must not restore'); },
      }),
      (error) => error.code === 'BACKUP_DATABASE_INVALID',
    );
    assert.equal(resetCalled, false);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test('manifest-declared missing project asset is rejected before database reset', async () => {
  const cwd = await mkdtemp(join(tmpdir(), 'yuncms-restore-assets-'));
  const backupPath = join(cwd, 'backup');
  await mkdir(backupPath);
  try {
    await writeManifest(backupPath, { packageJson: true });
    await writeFile(join(backupPath, 'database.sql.gz'), 'placeholder');
    let resetCalled = false;

    await assert.rejects(
      restoreProjectBackup({
        backupPath,
        cwd,
        env,
        output: { log() {} },
        async verifyDatabaseFn() { return { decompressedBytes: 10 }; },
        async resetDatabaseFn() { resetCalled = true; },
        async restoreDatabaseFn() { throw new Error('must not restore'); },
      }),
      (error) => error.code === 'BACKUP_ASSET_MISSING',
    );
    assert.equal(resetCalled, false);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});
