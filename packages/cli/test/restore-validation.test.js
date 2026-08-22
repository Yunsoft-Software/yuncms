import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
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

async function writeManifest(backupPath, project = {}, database = {}) {
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
      ...database,
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

test('different database target is rejected before validation or reset by default', async () => {
  const cwd = await mkdtemp(join(tmpdir(), 'yuncms-restore-target-'));
  const backupPath = join(cwd, 'backup');
  await mkdir(backupPath);
  try {
    await writeManifest(backupPath, {}, { database: 'source_database' });
    await writeFile(join(backupPath, 'database.sql.gz'), 'placeholder');
    let verifyCalled = false;
    let resetCalled = false;

    await assert.rejects(
      restoreProjectBackup({
        backupPath,
        cwd,
        env: { ...env, DB_DATABASE: 'recovery_database' },
        output: { log() {} },
        async verifyDatabaseFn() { verifyCalled = true; return { decompressedBytes: 10 }; },
        async resetDatabaseFn() { resetCalled = true; },
        async restoreDatabaseFn() { throw new Error('must not restore'); },
      }),
      (error) => error.code === 'BACKUP_DATABASE_TARGET_MISMATCH',
    );

    assert.equal(verifyCalled, false);
    assert.equal(resetCalled, false);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test('cross-database disaster recovery preserves current target env while restoring backup data', async () => {
  const cwd = await mkdtemp(join(tmpdir(), 'yuncms-restore-cross-db-'));
  const backupPath = join(cwd, 'backup');
  await mkdir(join(backupPath, 'project'), { recursive: true });
  try {
    await writeManifest(backupPath, { env: true }, { database: 'source_database' });
    await writeFile(join(backupPath, 'database.sql.gz'), 'placeholder');
    await writeFile(join(backupPath, 'project', '.env'), 'DB_DATABASE="source_database"\n');
    await writeFile(join(cwd, '.env'), 'DB_DATABASE="recovery_database"\nRECOVERY_ONLY="yes"\n');

    const sequence = [];
    let restoredDatabaseName = null;
    const warnings = [];
    await restoreProjectBackup({
      backupPath,
      cwd,
      env: { ...env, DB_DATABASE: 'recovery_database' },
      allowDifferentDatabaseTarget: true,
      output: {
        log() {},
        warn(message) { warnings.push(message); },
      },
      async verifyDatabaseFn() { sequence.push('verify'); return { decompressedBytes: 10 }; },
      async resetDatabaseFn({ config }) {
        sequence.push('reset');
        restoredDatabaseName = config.database;
      },
      async restoreDatabaseFn({ config }) {
        sequence.push('restore');
        restoredDatabaseName = config.database;
      },
    });

    assert.deepEqual(sequence, ['verify', 'reset', 'restore']);
    assert.equal(restoredDatabaseName, 'recovery_database');
    assert.equal(
      await readFile(join(cwd, '.env'), 'utf8'),
      'DB_DATABASE="recovery_database"\nRECOVERY_ONLY="yes"\n',
    );
    assert.ok(warnings.some((message) => message.includes('Preserving the current .env')));
    assert.equal(await readFile(join(backupPath, 'project', '.env'), 'utf8'), 'DB_DATABASE="source_database"\n');
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test('beforeDestructive guard runs after backup validation and can stop database reset', async () => {
  const cwd = await mkdtemp(join(tmpdir(), 'yuncms-restore-guard-'));
  const backupPath = join(cwd, 'backup');
  await mkdir(backupPath);
  try {
    await writeManifest(backupPath);
    await writeFile(join(backupPath, 'database.sql.gz'), 'placeholder');
    const sequence = [];
    let resetCalled = false;

    await assert.rejects(
      restoreProjectBackup({
        backupPath,
        cwd,
        env,
        output: { log() {} },
        async verifyDatabaseFn() {
          sequence.push('verify');
          return { decompressedBytes: 10 };
        },
        async beforeDestructive() {
          sequence.push('guard');
          const error = new Error('service restarted');
          error.code = 'UPDATE_APPLICATION_RUNNING';
          throw error;
        },
        async resetDatabaseFn() { resetCalled = true; },
        async restoreDatabaseFn() { throw new Error('must not restore'); },
      }),
      (error) => error.code === 'UPDATE_APPLICATION_RUNNING',
    );

    assert.deepEqual(sequence, ['verify', 'guard']);
    assert.equal(resetCalled, false);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

for (const targetKind of ['files', 'extensions']) {
  test(`restore rejects a backup source nested inside the ${targetKind} restore target before DB validation/reset`, async () => {
    const cwd = await mkdtemp(join(tmpdir(), `yuncms-restore-path-${targetKind}-`));
    const root = targetKind === 'files'
      ? join(cwd, '.yuncms', 'uploads')
      : join(cwd, 'extensions');
    const backupPath = join(root, 'moved-backup');
    await mkdir(backupPath, { recursive: true });
    try {
      await writeManifest(backupPath);
      await writeFile(join(backupPath, 'database.sql.gz'), 'placeholder');
      let verifyCalled = false;
      let resetCalled = false;

      await assert.rejects(
        restoreProjectBackup({
          backupPath,
          cwd,
          env,
          output: { log() {} },
          async verifyDatabaseFn() { verifyCalled = true; return { decompressedBytes: 10 }; },
          async resetDatabaseFn() { resetCalled = true; },
          async restoreDatabaseFn() { throw new Error('must not restore'); },
        }),
        (error) => error.code === 'BACKUP_RESTORE_PATH_CONFLICT'
          && error.backupPath === backupPath,
      );

      assert.equal(verifyCalled, false);
      assert.equal(resetCalled, false);
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });
}
