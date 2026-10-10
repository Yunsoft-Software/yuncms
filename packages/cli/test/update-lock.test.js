import assert from 'node:assert/strict';
import { lstat, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { hashMaintenanceBypassToken } from '@yunsoft/yuncms-core';

import { acquireUpdateLock, updateLockPath } from '../src/update-lock.js';

test('update lock is stable per project and lives outside the project tree', async () => {
  const cwd = await mkdtemp(join(tmpdir(), 'yuncms-lock-project-'));
  try {
    const path = updateLockPath(cwd);
    assert.equal(path.startsWith(cwd), false);
    assert.equal(updateLockPath(cwd), path);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test('operation lock stores only bypass-token hash and returns raw token in memory', async () => {
  const cwd = await mkdtemp(join(tmpdir(), 'yuncms-lock-token-'));
  const token = 'c'.repeat(64);
  try {
    const lock = await acquireUpdateLock({
      cwd,
      now: new Date('2026-08-22T09:00:00.000Z'),
      pid: 123,
      generateToken: () => token,
    });
    const stateText = await readFile(lock.path, 'utf8');
    const state = JSON.parse(stateText);

    assert.equal(lock.bypassToken, token);
    assert.equal(state.bypassTokenHash, hashMaintenanceBypassToken(token));
    assert.equal(stateText.includes(token), false);
    assert.equal(state.pid, 123);
    assert.equal(state.cwd, cwd);

    await lock.release();
  } finally {
    await rm(updateLockPath(cwd), { force: true }).catch(() => {});
    await rm(cwd, { recursive: true, force: true });
  }
});

test('second destructive operation fails while project lock is held and succeeds after release', async () => {
  const cwd = await mkdtemp(join(tmpdir(), 'yuncms-lock-project-'));
  try {
    const first = await acquireUpdateLock({
      cwd,
      now: new Date('2026-08-22T09:00:00.000Z'),
      pid: 123,
    });

    await assert.rejects(
      acquireUpdateLock({ cwd, pid: 456 }),
      (error) => error.code === 'UPDATE_ALREADY_RUNNING' && error.lockPath === first.path,
    );

    await first.release();
    const second = await acquireUpdateLock({ cwd, pid: 456 });
    await second.release();
  } finally {
    await rm(updateLockPath(cwd), { force: true }).catch(() => {});
    await rm(cwd, { recursive: true, force: true });
  }
});

test('multi-user isolation: different users acquire locks for the same project without contention', async () => {
  const tempRoot = await mkdtemp(join(tmpdir(), 'yuncms-multi-user-locks-'));
  const cwd = await mkdtemp(join(tmpdir(), 'yuncms-shared-proj-'));
  try {
    const lstatUserA = async (p) => {
      const st = await lstat(p);
      return {
        ...st,
        uid: 10001,
        isDirectory: () => st.isDirectory(),
        isSymbolicLink: () => st.isSymbolicLink(),
      };
    };
    const lstatUserB = async (p) => {
      const st = await lstat(p);
      return {
        ...st,
        uid: 10002,
        isDirectory: () => st.isDirectory(),
        isSymbolicLink: () => st.isSymbolicLink(),
      };
    };
    const lockUserA = await acquireUpdateLock({
      cwd,
      tempRoot,
      getuidFn: () => 10001,
      lstatFn: lstatUserA,
      pid: 101,
    });
    const lockUserB = await acquireUpdateLock({
      cwd,
      tempRoot,
      getuidFn: () => 10002,
      lstatFn: lstatUserB,
      pid: 102,
    });

    assert.notEqual(lockUserA.path, lockUserB.path);
    assert.equal(lockUserA.path.includes('yuncms-update-locks-10001'), true);
    assert.equal(lockUserB.path.includes('yuncms-update-locks-10002'), true);

    await lockUserA.release();
    await lockUserB.release();
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
    await rm(cwd, { recursive: true, force: true });
  }
});

test('accessible legacy active or malformed lock blocks new CLI acquisition', async () => {
  const tempRoot = await mkdtemp(join(tmpdir(), 'yuncms-legacy-cli-'));
  const cwd = await mkdtemp(join(tmpdir(), 'yuncms-legacy-cli-proj-'));
  const { legacyUpdateLockPath } = await import('../src/update-lock.js');
  const actualLegacyPath = legacyUpdateLockPath(cwd, { tempRoot });
  const { mkdir, writeFile } = await import('node:fs/promises');
  const { dirname } = await import('node:path');

  await mkdir(dirname(actualLegacyPath), { recursive: true, mode: 0o700 });
  await writeFile(actualLegacyPath, JSON.stringify({ pid: 888, startedAt: '2026-10-10T10:00:00.000Z', cwd, bypassTokenHash: 'abc' }));

  try {
    await assert.rejects(
      acquireUpdateLock({ cwd, tempRoot, pid: 999 }),
      (err) => err.code === 'UPDATE_ALREADY_RUNNING' && err.lockPath === actualLegacyPath,
    );

    // Malformed legacy lock also blocks acquisition
    await writeFile(actualLegacyPath, '{malformed');
    await assert.rejects(
      acquireUpdateLock({ cwd, tempRoot, pid: 999 }),
      (err) => err.code === 'UPDATE_ALREADY_RUNNING' && err.lockPath === actualLegacyPath,
    );
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
    await rm(cwd, { recursive: true, force: true });
  }
});

test('foreign-private legacy EACCES is ignored while own/insecure legacy EACCES blocks acquisition', async () => {
  const cwd = '/srv/projects/alpha';
  const tempRoot = await mkdtemp(join(tmpdir(), 'yuncms-cli-eacces-'));
  const { legacyUpdateLockPath } = await import('../src/update-lock.js');
  const legacyPath = legacyUpdateLockPath(cwd, { tempRoot });

  const readFileFn = async (p) => {
    if (p === legacyPath) {
      const err = new Error('Permission denied');
      err.code = 'EACCES';
      throw err;
    }
    const { readFile: realReadFile } = await import('node:fs/promises');
    return realReadFile(p, 'utf8');
  };

  // Foreign private legacy directory (UID 10001, mode 0700): ignored!
  const foreignLstat = async (p) => {
    if (p && p.includes('10002')) {
      return {
        isSymbolicLink: () => false,
        isDirectory: () => true,
        uid: 10002,
        mode: 0o040700,
      };
    }
    return {
      isSymbolicLink: () => false,
      isDirectory: () => true,
      uid: 10001,
      mode: 0o040700,
    };
  };

  const lock = await acquireUpdateLock({
    cwd,
    tempRoot,
    getuidFn: () => 10002,
    readFileFn,
    lstatFn: foreignLstat,
  });
  assert.ok(lock.path);
  await lock.release();

  // Negative: own UID giving EACCES blocks acquisition
  const ownLstat = async () => ({
    isSymbolicLink: () => false,
    isDirectory: () => true,
    uid: 10002,
    mode: 0o040700,
  });

  await assert.rejects(
    acquireUpdateLock({
      cwd,
      tempRoot,
      getuidFn: () => 10002,
      readFileFn,
      lstatFn: ownLstat,
    }),
    (err) => err.code === 'UPDATE_ALREADY_RUNNING',
  );

  await rm(tempRoot, { recursive: true, force: true });
});

test('release unlinks own lock file without removing shared per-user parent directory', async () => {
  const tempRoot = await mkdtemp(join(tmpdir(), 'yuncms-cleanup-test-'));
  const cwd = await mkdtemp(join(tmpdir(), 'yuncms-cleanup-proj-'));
  const { access } = await import('node:fs/promises');
  const { dirname } = await import('node:path');

  try {
    const lock = await acquireUpdateLock({ cwd, tempRoot });
    const parent = dirname(lock.path);
    await assert.doesNotReject(access(lock.path));
    await assert.doesNotReject(access(parent));

    await lock.release();

    // Lock file must be unlinked
    await assert.rejects(access(lock.path), (err) => err.code === 'ENOENT');
    // Shared per-user parent directory must remain intact
    await assert.doesNotReject(access(parent));
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
    await rm(cwd, { recursive: true, force: true });
  }
});

test('acquireUpdateLock fails closed when current per-user parent directory is insecure or symlink', async () => {
  const tempRoot = await mkdtemp(join(tmpdir(), 'yuncms-insecure-cli-'));
  const cwd = await mkdtemp(join(tmpdir(), 'yuncms-insecure-proj-'));
  const { mkdir, chmod, symlink } = await import('node:fs/promises');
  const { dirname } = await import('node:path');
  const { updateLockPath } = await import('../src/update-lock.js');

  try {
    const path = updateLockPath(cwd, { tempRoot, getuidFn: () => 10001 });
    const parent = dirname(path);
    await mkdir(parent, { recursive: true, mode: 0o755 });
    await chmod(parent, 0o755);

    // Insecure permissions: fails closed!
    await assert.rejects(
      acquireUpdateLock({ cwd, tempRoot, getuidFn: () => 10001 }),
      (err) => err.code === 'YUNCMS_MAINTENANCE_ACTIVE',
    );

    await rm(parent, { recursive: true, force: true });

    // Symlink: fails closed!
    const realDir = join(tempRoot, 'real-parent');
    await mkdir(realDir, { recursive: true, mode: 0o700 });
    await symlink(realDir, parent);

    await assert.rejects(
      acquireUpdateLock({ cwd, tempRoot, getuidFn: () => 10001 }),
      (err) => err.code === 'YUNCMS_MAINTENANCE_ACTIVE',
    );
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
    await rm(cwd, { recursive: true, force: true });
  }
});
