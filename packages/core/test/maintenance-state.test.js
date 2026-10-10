import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';

import {
  assertMaintenanceStartupAllowed,
  hashMaintenanceBypassToken,
  legacyMaintenanceLockPath,
  MAINTENANCE_BYPASS_ENV,
  maintenanceLockPath,
  resolveUserIdentity,
} from '../src/maintenance-state.js';

async function writeLock(cwd, state) {
  const path = maintenanceLockPath(cwd);
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  await writeFile(path, `${JSON.stringify(state)}\n`, { mode: 0o600 });
  return path;
}

test('maintenance lock path is deterministic per project and outside the project tree', async () => {
  const cwd = await mkdtemp(join(tmpdir(), 'yuncms-maintenance-project-'));
  try {
    const path = maintenanceLockPath(cwd);
    assert.equal(path.startsWith(cwd), false);
    assert.equal(maintenanceLockPath(cwd), path);
  } finally {
    await rm(maintenanceLockPath(cwd), { force: true }).catch(() => {});
    await rm(cwd, { recursive: true, force: true });
  }
});

test('symlink aliases for the same physical project share one maintenance lock identity', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'yuncms-maintenance-alias-'));
  const project = join(root, 'project');
  const alias = join(root, 'alias');
  await mkdir(project);
  try {
    try {
      await symlink(project, alias, 'dir');
    } catch (error) {
      if (error?.code === 'EPERM' || error?.code === 'EACCES') {
        t.skip(`directory symlink unavailable: ${error.code}`);
        return;
      }
      throw error;
    }
    assert.equal(maintenanceLockPath(project), maintenanceLockPath(alias));
  } finally {
    await rm(maintenanceLockPath(project), { force: true }).catch(() => {});
    await rm(root, { recursive: true, force: true });
  }
});

test('startup is allowed when no maintenance operation is active', async () => {
  const cwd = await mkdtemp(join(tmpdir(), 'yuncms-maintenance-none-'));
  try {
    await assert.doesNotReject(assertMaintenanceStartupAllowed({ cwd, env: {} }));
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test('maintenance state blocks normal startup but permits only the matching bypass token', async () => {
  const cwd = await mkdtemp(join(tmpdir(), 'yuncms-maintenance-token-'));
  const token = 'a'.repeat(64);
  const path = await writeLock(cwd, {
    pid: 123,
    startedAt: '2026-08-22T10:00:00.000Z',
    cwd,
    bypassTokenHash: hashMaintenanceBypassToken(token),
  });

  try {
    await assert.rejects(
      assertMaintenanceStartupAllowed({ cwd, env: {} }),
      (error) => error.code === 'YUNCMS_MAINTENANCE_ACTIVE'
        && error.lockPath === path
        && error.pid === 123,
    );
    await assert.rejects(
      assertMaintenanceStartupAllowed({
        cwd,
        env: { [MAINTENANCE_BYPASS_ENV]: 'b'.repeat(64) },
      }),
      (error) => error.code === 'YUNCMS_MAINTENANCE_ACTIVE',
    );
    await assert.doesNotReject(
      assertMaintenanceStartupAllowed({
        cwd,
        env: { [MAINTENANCE_BYPASS_ENV]: token },
      }),
    );
  } finally {
    await rm(path, { force: true });
    await rm(cwd, { recursive: true, force: true });
  }
});

test('malformed or legacy maintenance lock fails closed instead of allowing startup', async () => {
  const cwd = await mkdtemp(join(tmpdir(), 'yuncms-maintenance-invalid-'));
  const path = maintenanceLockPath(cwd);
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  try {
    await writeFile(path, '{not-json', { mode: 0o600 });
    await assert.rejects(
      assertMaintenanceStartupAllowed({ cwd, env: {} }),
      (error) => error.code === 'YUNCMS_MAINTENANCE_ACTIVE',
    );

    await writeFile(path, `${JSON.stringify({ pid: 1, startedAt: '2026-08-22T10:00:00.000Z' })}\n`);
    await assert.rejects(
      assertMaintenanceStartupAllowed({
        cwd,
        env: { [MAINTENANCE_BYPASS_ENV]: 'a'.repeat(64) },
      }),
      (error) => error.code === 'YUNCMS_MAINTENANCE_ACTIVE',
    );
  } finally {
    await rm(path, { force: true });
    await rm(cwd, { recursive: true, force: true });
  }
});

test('per-OS-user lock path isolation: same project distinct users, distinct projects same user', () => {
  const cwd1 = '/srv/projects/alpha';
  const cwd2 = '/srv/projects/beta';
  const tempRoot = '/tmp/yuncms-test-root';

  const userA = maintenanceLockPath(cwd1, { tempRoot, getuidFn: () => 10001 });
  const userB = maintenanceLockPath(cwd1, { tempRoot, getuidFn: () => 10002 });
  const userAProject2 = maintenanceLockPath(cwd2, { tempRoot, getuidFn: () => 10001 });

  // Same project, different users -> distinct private parent directory
  assert.notEqual(userA, userB);
  assert.equal(userA.includes('yuncms-update-locks-10001'), true);
  assert.equal(userB.includes('yuncms-update-locks-10002'), true);

  // Different projects, same user -> same parent dir, different filename
  assert.notEqual(userA, userAProject2);
  assert.equal(dirname(userA), dirname(userAProject2));

  // Non-uid username fallback (Windows / no getuidFn)
  const hashedUser = maintenanceLockPath(cwd1, {
    tempRoot,
    getuidFn: null,
    userInfoFn: () => ({ username: 'operator' }),
  });
  assert.match(hashedUser, /yuncms-update-locks-[0-9a-f]{32}/);

  // Invalid getuid function returns (null, NaN, -1) fail closed instead of silently falling back
  for (const badUid of [null, NaN, -1]) {
    assert.throws(
      () => maintenanceLockPath(cwd1, {
        tempRoot,
        getuidFn: () => badUid,
        userInfoFn: () => ({ username: 'operator' }),
      }),
      (err) => err.code === 'OS_USER_IDENTITY_UNAVAILABLE',
    );
  }

  // Unavailable identity throws clear error
  assert.throws(
    () => maintenanceLockPath(cwd1, {
      tempRoot,
      getuidFn: null,
      userInfoFn: () => ({}),
    }),
    (err) => err.code === 'OS_USER_IDENTITY_UNAVAILABLE',
  );
});

test('accessible active legacy 0.1.26 lock blocks startup but honors bypass token', async () => {
  const tempRoot = await mkdtemp(join(tmpdir(), 'yuncms-legacy-active-'));
  const cwd = await mkdtemp(join(tmpdir(), 'yuncms-legacy-proj-'));
  const token = 'd'.repeat(64);
  const legacyPath = legacyMaintenanceLockPath(cwd, { tempRoot });
  await mkdir(dirname(legacyPath), { recursive: true, mode: 0o700 });
  await writeFile(
    legacyPath,
    JSON.stringify({
      pid: 999,
      startedAt: '2026-10-10T12:00:00.000Z',
      cwd,
      bypassTokenHash: hashMaintenanceBypassToken(token),
    }),
  );

  try {
    // Blocks startup without bypass token
    await assert.rejects(
      assertMaintenanceStartupAllowed({ cwd, tempRoot, env: {} }),
      (err) => err.code === 'YUNCMS_MAINTENANCE_ACTIVE' && err.lockPath === legacyPath && err.pid === 999,
    );

    // Blocks startup with invalid bypass token
    await assert.rejects(
      assertMaintenanceStartupAllowed({ cwd, tempRoot, env: { [MAINTENANCE_BYPASS_ENV]: 'e'.repeat(64) } }),
      (err) => err.code === 'YUNCMS_MAINTENANCE_ACTIVE',
    );

    // Honors matching bypass token
    await assert.doesNotReject(
      assertMaintenanceStartupAllowed({ cwd, tempRoot, env: { [MAINTENANCE_BYPASS_ENV]: token } }),
    );
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
    await rm(cwd, { recursive: true, force: true });
  }
});

test('accessible corrupt legacy lock fails closed', async () => {
  const tempRoot = await mkdtemp(join(tmpdir(), 'yuncms-legacy-corrupt-'));
  const cwd = await mkdtemp(join(tmpdir(), 'yuncms-legacy-proj-'));
  const legacyPath = legacyMaintenanceLockPath(cwd, { tempRoot });
  await mkdir(dirname(legacyPath), { recursive: true, mode: 0o700 });
  await writeFile(legacyPath, 'broken-json{{{');

  try {
    await assert.rejects(
      assertMaintenanceStartupAllowed({ cwd, tempRoot, env: {} }),
      (err) => err.code === 'YUNCMS_MAINTENANCE_ACTIVE' && err.lockPath === legacyPath,
    );
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
    await rm(cwd, { recursive: true, force: true });
  }
});

test('foreign-private legacy directory EACCES is safely ignored', async () => {
  const cwd = '/srv/projects/example';
  const legacyPath = legacyMaintenanceLockPath(cwd, { tempRoot: '/tmp/yuncms-mock-tmp' });

  // Mock readFileFn: legacyPath throws EACCES; currentPath throws ENOENT (no lock)
  const readFileFn = async (p) => {
    if (p === legacyPath) {
      const err = new Error('Permission denied');
      err.code = 'EACCES';
      throw err;
    }
    const err = new Error('Not found');
    err.code = 'ENOENT';
    throw err;
  };

  // Mock lstatFn: parent of legacyPath is a directory owned by foreign UID 10001 with mode 0700 (private)
  const lstatFn = async (p) => {
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
      uid: 10001, // foreign UID (we are 10002)
      mode: 0o040700, // S_IFDIR | 0700
    };
  };

  await assert.doesNotReject(
    assertMaintenanceStartupAllowed({
      cwd,
      tempRoot: '/tmp/yuncms-mock-tmp',
      getuidFn: () => 10002,
      readFileFn,
      lstatFn,
      env: {},
    }),
  );
});

test('negative legacy EACCES: own UID, insecure mode, symlink, unknown UID fail closed', async () => {
  const cwd = '/srv/projects/example';
  const legacyPath = legacyMaintenanceLockPath(cwd, { tempRoot: '/tmp/yuncms-mock-tmp' });

  const readFileFn = async () => {
    const err = new Error('Permission denied');
    err.code = 'EACCES';
    throw err;
  };

  // Case 1: Own UID (10002 owns it, but gives EACCES)
  await assert.rejects(
    assertMaintenanceStartupAllowed({
      cwd,
      tempRoot: '/tmp/yuncms-mock-tmp',
      getuidFn: () => 10002,
      readFileFn,
      lstatFn: async () => ({
        isSymbolicLink: () => false,
        isDirectory: () => true,
        uid: 10002, // own UID!
        mode: 0o040700,
      }),
      env: {},
    }),
    (err) => err.code === 'YUNCMS_MAINTENANCE_ACTIVE',
  );

  // Case 2: Insecure mode (foreign UID 10001, but mode 0755 has world/group traversal)
  await assert.rejects(
    assertMaintenanceStartupAllowed({
      cwd,
      tempRoot: '/tmp/yuncms-mock-tmp',
      getuidFn: () => 10002,
      readFileFn,
      lstatFn: async () => ({
        isSymbolicLink: () => false,
        isDirectory: () => true,
        uid: 10001,
        mode: 0o040755, // group and other execute/read!
      }),
      env: {},
    }),
    (err) => err.code === 'YUNCMS_MAINTENANCE_ACTIVE',
  );

  // Case 3: Insecure mode (group traversal 0710)
  await assert.rejects(
    assertMaintenanceStartupAllowed({
      cwd,
      tempRoot: '/tmp/yuncms-mock-tmp',
      getuidFn: () => 10002,
      readFileFn,
      lstatFn: async () => ({
        isSymbolicLink: () => false,
        isDirectory: () => true,
        uid: 10001,
        mode: 0o040710, // group execute!
      }),
      env: {},
    }),
    (err) => err.code === 'YUNCMS_MAINTENANCE_ACTIVE',
  );

  // Case 4: Symbolic link parent
  await assert.rejects(
    assertMaintenanceStartupAllowed({
      cwd,
      tempRoot: '/tmp/yuncms-mock-tmp',
      getuidFn: () => 10002,
      readFileFn,
      lstatFn: async () => ({
        isSymbolicLink: () => true, // symlink!
        isDirectory: () => true,
        uid: 10001,
        mode: 0o040700,
      }),
      env: {},
    }),
    (err) => err.code === 'YUNCMS_MAINTENANCE_ACTIVE',
  );

  // Case 5: Unknown parent UID
  await assert.rejects(
    assertMaintenanceStartupAllowed({
      cwd,
      tempRoot: '/tmp/yuncms-mock-tmp',
      getuidFn: () => 10002,
      readFileFn,
      lstatFn: async () => ({
        isSymbolicLink: () => false,
        isDirectory: () => true,
        uid: undefined, // unknown UID
        mode: 0o040700,
      }),
      env: {},
    }),
    (err) => err.code === 'YUNCMS_MAINTENANCE_ACTIVE',
  );
});

test('startup fails closed when current per-user parent directory is insecure or a symlink', async () => {
  const cwd = '/srv/projects/alpha';
  const tempRoot = await mkdtemp(join(tmpdir(), 'yuncms-insecure-parent-'));

  try {
    const currentPath = maintenanceLockPath(cwd, { tempRoot, getuidFn: () => 10001 });
    const currentParent = dirname(currentPath);
    await mkdir(currentParent, { recursive: true, mode: 0o755 });
    const { chmod, symlink } = await import('node:fs/promises');
    await chmod(currentParent, 0o755);

    await assert.rejects(
      assertMaintenanceStartupAllowed({
        cwd,
        tempRoot,
        getuidFn: () => 10001,
        env: {},
      }),
      (err) => err.code === 'YUNCMS_MAINTENANCE_ACTIVE',
    );

    await rm(currentParent, { recursive: true, force: true });

    // Symlink current parent
    const realDir = join(tempRoot, 'real-parent');
    await mkdir(realDir, { recursive: true, mode: 0o700 });
    await symlink(realDir, currentParent);

    await assert.rejects(
      assertMaintenanceStartupAllowed({
        cwd,
        tempRoot,
        getuidFn: () => 10001,
        env: {},
      }),
      (err) => err.code === 'YUNCMS_MAINTENANCE_ACTIVE',
    );
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test('Windows compatibility: assertSecureUserParentDir supports no-uid platforms without enforcing POSIX 0700 mode', async () => {
  const { assertSecureUserParentDir } = await import('../src/maintenance-state.js');

  // Injected Windows-like stat: mode is not 0700 (e.g. 0o040666), non-symlink directory, getuidFn is null
  const windowsStat = {
    isSymbolicLink: () => false,
    isDirectory: () => true,
    mode: 0o040666,
  };
  await assert.doesNotReject(
    assertSecureUserParentDir('/mock/win/parent', {
      lstatFn: async () => windowsStat,
      getuidFn: null,
    }),
  );

  // Windows-like symlink must still fail closed
  const windowsSymlinkStat = {
    isSymbolicLink: () => true,
    isDirectory: () => true,
    mode: 0o040666,
  };
  await assert.rejects(
    assertSecureUserParentDir('/mock/win/parent', {
      lstatFn: async () => windowsSymlinkStat,
      getuidFn: null,
    }),
    (err) => err.code === 'YUNCMS_MAINTENANCE_ACTIVE',
  );

  // Windows-like non-directory must still fail closed
  const windowsFileStat = {
    isSymbolicLink: () => false,
    isDirectory: () => false,
    mode: 0o040666,
  };
  await assert.rejects(
    assertSecureUserParentDir('/mock/win/parent', {
      lstatFn: async () => windowsFileStat,
      getuidFn: null,
    }),
    (err) => err.code === 'YUNCMS_MAINTENANCE_ACTIVE',
  );

  // Invalid getuidFn return (-1, NaN, null) must fail closed in assertSecureUserParentDir
  for (const invalidUid of [-1, NaN, null, 'not-a-number']) {
    await assert.rejects(
      assertSecureUserParentDir('/mock/unix/parent', {
        lstatFn: async () => ({
          isSymbolicLink: () => false,
          isDirectory: () => true,
          mode: 0o040700,
          uid: 10001,
        }),
        getuidFn: () => invalidUid,
      }),
      (err) => err.code === 'YUNCMS_MAINTENANCE_ACTIVE',
    );
  }
});
