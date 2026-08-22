import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { hashDirectory, hashFile } from '../src/backup-integrity.js';
import { createProjectBackup, restoreProjectBackup } from '../src/project-backup.js';

const env = {
  DB_HOST: '127.0.0.1',
  DB_PORT: '3306',
  DB_DATABASE: 'yuncms_test',
  DB_USER: 'yuncms',
  DB_PASSWORD: 'secret',
  FILES_LOCAL_ROOT: '.yuncms/uploads',
};

function silentOutput() {
  return { log() {}, warn() {}, error() {} };
}

async function createFixtureProject(cwd) {
  await mkdir(join(cwd, '.yuncms', 'uploads'), { recursive: true });
  await mkdir(join(cwd, 'extensions'), { recursive: true });
  await writeFile(join(cwd, '.env'), 'DB_DATABASE="yuncms_test"\n');
  await writeFile(join(cwd, 'package.json'), '{"dependencies":{"@yunsoft/yuncms":"0.1.3"}}\n');
  await writeFile(join(cwd, 'package-lock.json'), '{"lockfileVersion":3}\n');
  await writeFile(join(cwd, '.yuncms', 'uploads', 'asset.txt'), 'asset-before\n');
  await writeFile(join(cwd, 'extensions', 'extension.js'), 'export default "before";\n');
}

async function createHashedBackup(cwd) {
  return createProjectBackup({
    cwd,
    env,
    output: silentOutput(),
    async dumpDatabaseFn({ outputPath }) {
      await writeFile(outputPath, 'fake-compressed-database');
    },
    async verifyDatabaseFn() {
      return { decompressedBytes: 128 };
    },
  });
}

test('file and directory hashes are deterministic and content-sensitive', async () => {
  const cwd = await mkdtemp(join(tmpdir(), 'yuncms-integrity-hash-'));
  try {
    const directory = join(cwd, 'tree');
    await mkdir(join(directory, 'nested'), { recursive: true });
    await writeFile(join(directory, 'a.txt'), 'alpha');
    await writeFile(join(directory, 'nested', 'b.txt'), 'beta');

    const firstDirectoryHash = await hashDirectory(directory);
    const secondDirectoryHash = await hashDirectory(directory);
    assert.equal(firstDirectoryHash, secondDirectoryHash);
    assert.match(firstDirectoryHash, /^[0-9a-f]{64}$/);

    const firstFileHash = await hashFile(join(directory, 'a.txt'));
    await writeFile(join(directory, 'a.txt'), 'changed');
    assert.notEqual(await hashFile(join(directory, 'a.txt')), firstFileHash);
    assert.notEqual(await hashDirectory(directory), firstDirectoryHash);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test('format 2 backup records SHA-256 digests for database and present project assets', async () => {
  const cwd = await mkdtemp(join(tmpdir(), 'yuncms-integrity-manifest-'));
  try {
    await createFixtureProject(cwd);
    const backup = await createHashedBackup(cwd);

    assert.equal(backup.manifest.format, 2);
    assert.equal(backup.manifest.integrity.algorithm, 'sha256');
    assert.match(backup.manifest.integrity.database, /^[0-9a-f]{64}$/);
    for (const key of ['env', 'packageJson', 'packageLock', 'extensions', 'localFiles']) {
      assert.match(backup.manifest.integrity.project[key], /^[0-9a-f]{64}$/);
    }
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

for (const [label, mutate] of [
  ['project file', async (backupPath) => writeFile(join(backupPath, 'project', 'package.json'), '{"tampered":true}\n')],
  ['local files tree', async (backupPath) => writeFile(join(backupPath, 'files', 'asset.txt'), 'tampered\n')],
  ['extensions tree', async (backupPath) => writeFile(join(backupPath, 'extensions', 'extension.js'), 'tampered\n')],
]) {
  test(`tampered ${label} is rejected before destructive database reset`, async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'yuncms-integrity-tamper-'));
    try {
      await createFixtureProject(cwd);
      const backup = await createHashedBackup(cwd);
      await mutate(backup.backupPath);
      let resetCalled = false;

      await assert.rejects(
        restoreProjectBackup({
          backupPath: backup.backupPath,
          cwd,
          env,
          output: silentOutput(),
          async verifyDatabaseFn() { return { decompressedBytes: 128 }; },
          async resetDatabaseFn() { resetCalled = true; },
        }),
        (error) => error.code === 'BACKUP_INTEGRITY_MISMATCH',
      );
      assert.equal(resetCalled, false);
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });
}

test('tampered compressed database digest is rejected before reset even when gzip validation is stubbed', async () => {
  const cwd = await mkdtemp(join(tmpdir(), 'yuncms-integrity-db-'));
  try {
    await createFixtureProject(cwd);
    const backup = await createHashedBackup(cwd);
    await writeFile(join(backup.backupPath, 'database.sql.gz'), 'changed-database-bytes');
    let resetCalled = false;

    await assert.rejects(
      restoreProjectBackup({
        backupPath: backup.backupPath,
        cwd,
        env,
        output: silentOutput(),
        async verifyDatabaseFn() { return { decompressedBytes: 128 }; },
        async resetDatabaseFn() { resetCalled = true; },
      }),
      (error) => error.code === 'BACKUP_INTEGRITY_MISMATCH',
    );
    assert.equal(resetCalled, false);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test('invalid format 2 integrity metadata is rejected before database validation', async () => {
  const cwd = await mkdtemp(join(tmpdir(), 'yuncms-integrity-metadata-'));
  try {
    await createFixtureProject(cwd);
    const backup = await createHashedBackup(cwd);
    const manifestPath = join(backup.backupPath, 'manifest.json');
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
    manifest.integrity.project.packageJson = 'not-a-digest';
    await writeFile(manifestPath, `${JSON.stringify(manifest)}\n`);
    let verifyCalled = false;

    await assert.rejects(
      restoreProjectBackup({
        backupPath: backup.backupPath,
        cwd,
        env,
        output: silentOutput(),
        async verifyDatabaseFn() { verifyCalled = true; return { decompressedBytes: 128 }; },
      }),
      (error) => error.code === 'BACKUP_MANIFEST_INVALID',
    );
    assert.equal(verifyCalled, false);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test('managed backup refuses symlinked snapshot inputs instead of changing restore semantics', async (t) => {
  const cwd = await mkdtemp(join(tmpdir(), 'yuncms-integrity-symlink-'));
  try {
    await mkdir(join(cwd, '.yuncms', 'uploads'), { recursive: true });
    await writeFile(join(cwd, 'real-env'), 'SECRET=value\n');
    try {
      await symlink(join(cwd, 'real-env'), join(cwd, '.env'));
    } catch (error) {
      if (error?.code === 'EPERM' || error?.code === 'EACCES') {
        t.skip(`symlink creation unavailable: ${error.code}`);
        return;
      }
      throw error;
    }

    await assert.rejects(
      createHashedBackup(cwd),
      (error) => error.code === 'BACKUP_SYMLINK_UNSUPPORTED',
    );
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});
