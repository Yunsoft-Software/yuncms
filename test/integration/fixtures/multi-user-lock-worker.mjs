// Tracked multi-user isolation worker fixture for GitHub Issue #44
// Executed as root inside disposable Node 24 Docker container:
// docker run --rm -v "$PWD":/workspace:ro -w /workspace node:24-bookworm-slim node test/integration/fixtures/multi-user-lock-worker.mjs

import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';

console.log('Running two-user multi-user lock worker (UID 10001 & 10002)...');

const UID_A = 10001;
const GID_A = 10001;
const UID_B = 10002;
const GID_B = 10002;

// 1. Provision test users
function ensureUser(username, uid, gid) {
  const gCheck = spawnSync('getent', ['group', String(gid)]);
  if (gCheck.status !== 0) {
    const gResult = spawnSync('groupadd', ['-g', String(gid), username], { encoding: 'utf8' });
    if (gResult.status !== 0 && !gResult.stderr.includes('already exists')) {
      throw new Error(`Failed to create group ${username} (${gid}): ${gResult.stderr}`);
    }
  }
  const uCheck = spawnSync('id', ['-u', username]);
  if (uCheck.status !== 0) {
    const uResult = spawnSync('useradd', ['-u', String(uid), '-g', String(gid), '-m', username], { encoding: 'utf8' });
    if (uResult.status !== 0 && !uResult.stderr.includes('already exists')) {
      throw new Error(`Failed to create user ${username} (${uid}): ${uResult.stderr}`);
    }
  }
}

ensureUser('userA', UID_A, GID_A);
ensureUser('userB', UID_B, GID_B);

const PROJECT_A = '/home/userA/projectA';
const PROJECT_B = '/home/userB/projectB';

mkdirSync(PROJECT_A, { recursive: true, mode: 0o700 });
mkdirSync(PROJECT_B, { recursive: true, mode: 0o700 });
spawnSync('chown', ['-R', `${UID_A}:${GID_A}`, '/home/userA']);
spawnSync('chown', ['-R', `${UID_B}:${GID_B}`, '/home/userB']);

// Helper to run a Node snippet as a specific UID/GID with bounded timeout
function runAsUser(uid, gid, cwd, code, extraEnv = {}) {
  return new Promise((res, rej) => {
    const child = spawn(
      process.execPath,
      ['--input-type=module', '-e', code],
      {
        cwd,
        uid,
        gid,
        env: {
          PATH: process.env.PATH,
          ...extraEnv,
        },
        stdio: ['ignore', 'pipe', 'pipe'],
        timeout: 10_000,
        killSignal: 'SIGKILL',
      },
    );

    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => { stdout += d; });
    child.stderr.on('data', (d) => { stderr += d; });

    child.on('close', (code, signal) => {
      res({
        code,
        signal,
        stdout: stdout.trim(),
        stderr: stderr.trim(),
      });
    });
  });
}

// Clean up any lingering test locks in /tmp
rmSync('/tmp/yuncms-update-locks', { recursive: true, force: true });
rmSync(`/tmp/yuncms-update-locks-${UID_A}`, { recursive: true, force: true });
rmSync(`/tmp/yuncms-update-locks-${UID_B}`, { recursive: true, force: true });
rmSync('/tmp/b-token.txt', { force: true });

try {
  // Step 1: UserA creates legacy shared directory /tmp/yuncms-update-locks with mode 0700 and an active lock
  console.log('[1/7] UserA writes active legacy lock in /tmp/yuncms-update-locks (mode 0700)...');
  const setupA = await runAsUser(
    UID_A,
    GID_A,
    PROJECT_A,
    `
    import { legacyMaintenanceLockPath, hashMaintenanceBypassToken } from '/workspace/packages/core/src/index.js';
    import { mkdirSync, writeFileSync } from 'node:fs';
    import { dirname } from 'node:path';

    const path = legacyMaintenanceLockPath(process.cwd());
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    writeFileSync(path, JSON.stringify({
      pid: 99999,
      startedAt: new Date().toISOString(),
      cwd: process.cwd(),
      bypassTokenHash: hashMaintenanceBypassToken('synthetic_fixture_token_a_32chars_long!'),
    }, null, 2), { mode: 0o600 });
    console.log(path);
    `,
  );
  assert.equal(setupA.code, 0, `UserA legacy setup failed: ${setupA.stderr}`);
  const legacyLockPath = setupA.stdout;
  const legacyDirStat = statSync('/tmp/yuncms-update-locks');
  assert.equal(legacyDirStat.uid, UID_A);
  assert.equal(legacyDirStat.mode & 0o777, 0o700);

  // Step 2: UserB startup check succeeds despite foreign 0700 legacy parent (foreign EACCES safely ignored)
  console.log('[2/7] UserB startup check succeeds (foreign legacy 0700 EACCES ignored)...');
  const startupB1 = await runAsUser(
    UID_B,
    GID_B,
    PROJECT_B,
    `
    import { assertMaintenanceStartupAllowed } from '/workspace/packages/core/src/index.js';
    await assertMaintenanceStartupAllowed({ cwd: process.cwd() });
    console.log('STARTUP_ALLOWED');
    `,
  );
  assert.equal(startupB1.code, 0, `UserB startup failed: ${startupB1.stderr}`);
  assert.equal(startupB1.stdout, 'STARTUP_ALLOWED');

  // Step 3: UserB acquires update lock in per-user private directory (/tmp/yuncms-update-locks-10002)
  console.log('[3/7] UserB acquires lock in isolated /tmp/yuncms-update-locks-10002...');
  const acquireB = await runAsUser(
    UID_B,
    GID_B,
    PROJECT_B,
    `
    import { acquireUpdateLock } from '/workspace/packages/cli/src/update-lock.js';
    import { writeFileSync } from 'node:fs';
    const lock = await acquireUpdateLock({ cwd: process.cwd() });
    writeFileSync('/tmp/b-token.txt', lock.bypassToken, { mode: 0o600 });
    console.log(lock.path);
    `,
  );
  assert.equal(acquireB.code, 0, `UserB lock acquisition failed: ${acquireB.stderr}`);
  const bLockPath = acquireB.stdout;
  const bDirStat = statSync(`/tmp/yuncms-update-locks-${UID_B}`);
  assert.equal(bDirStat.uid, UID_B);
  assert.equal(bDirStat.mode & 0o777, 0o700);

  // Step 4: UserA startup is blocked by UserA's own active legacy lock
  console.log('[4/7] UserA startup blocked by own legacy lock...');
  const startupA = await runAsUser(
    UID_A,
    GID_A,
    PROJECT_A,
    `
    import { assertMaintenanceStartupAllowed } from '/workspace/packages/core/src/index.js';
    try {
      await assertMaintenanceStartupAllowed({ cwd: process.cwd() });
      process.exit(0);
    } catch (err) {
      if (err?.code === 'YUNCMS_MAINTENANCE_ACTIVE') {
        console.log('BLOCKED_ACTIVE');
        process.exit(42);
      }
      console.error(err);
      process.exit(1);
    }
    `,
  );
  assert.equal(startupA.code, 42, `UserA startup blocked check failed (expected 42, got ${startupA.code}): ${startupA.stderr}`);
  assert.equal(startupA.stdout, 'BLOCKED_ACTIVE');

  // Step 5: UserB startup is blocked without bypass token, allowed with valid bypass token
  console.log('[5/7] UserB startup blocked without bypass token; allowed with valid bypass token...');
  const bToken = readFileSync('/tmp/b-token.txt', 'utf8').trim();

  const startupBBlocked = await runAsUser(
    UID_B,
    GID_B,
    PROJECT_B,
    `
    import { assertMaintenanceStartupAllowed } from '/workspace/packages/core/src/index.js';
    try {
      await assertMaintenanceStartupAllowed({ cwd: process.cwd() });
      process.exit(0);
    } catch (err) {
      if (err?.code === 'YUNCMS_MAINTENANCE_ACTIVE') {
        console.log('BLOCKED_ACTIVE');
        process.exit(42);
      }
      console.error(err);
      process.exit(1);
    }
    `,
  );
  assert.equal(startupBBlocked.code, 42, `UserB startup blocked check failed (expected 42, got ${startupBBlocked.code}): ${startupBBlocked.stderr}`);

  const startupBAllowed = await runAsUser(
    UID_B,
    GID_B,
    PROJECT_B,
    `
    import { assertMaintenanceStartupAllowed, MAINTENANCE_BYPASS_ENV } from '/workspace/packages/core/src/index.js';
    await assertMaintenanceStartupAllowed({
      cwd: process.cwd(),
      env: { ...process.env, [MAINTENANCE_BYPASS_ENV]: process.env[MAINTENANCE_BYPASS_ENV] },
    });
    console.log('BYPASS_ACCEPTED');
    `,
    {
      YUNCMS_MAINTENANCE_BYPASS_TOKEN: bToken,
    },
  );
  assert.equal(startupBAllowed.code, 0, `UserB bypass allowed check failed (expected 0, got ${startupBAllowed.code}): ${startupBAllowed.stderr}`);
  assert.equal(startupBAllowed.stdout, 'BYPASS_ACCEPTED');

  // Step 6: Concurrent UserB CLI lock acquisition is rejected with UPDATE_ALREADY_RUNNING
  console.log('[6/7] Second UserB CLI acquisition rejected with UPDATE_ALREADY_RUNNING...');
  const secondB = await runAsUser(
    UID_B,
    GID_B,
    PROJECT_B,
    `
    import { acquireUpdateLock } from '/workspace/packages/cli/src/update-lock.js';
    try {
      await acquireUpdateLock({ cwd: process.cwd() });
      process.exit(0);
    } catch (err) {
      if (err?.code === 'UPDATE_ALREADY_RUNNING') {
        console.log('UPDATE_ALREADY_RUNNING');
        process.exit(43);
      }
      console.error(err);
      process.exit(1);
    }
    `,
  );
  assert.equal(secondB.code, 43, `UserB concurrent acquisition failed (expected 43, got ${secondB.code}): ${secondB.stderr}`);
  assert.equal(secondB.stdout, 'UPDATE_ALREADY_RUNNING');

  // Step 7: Release locks and verify foreign legacy parent remains untouched
  console.log('[7/7] Verifying UserA legacy parent remained intact (mode 0700)...');
  const legacyStatAfter = statSync('/tmp/yuncms-update-locks');
  assert.equal(legacyStatAfter.uid, UID_A);
  assert.equal(legacyStatAfter.mode & 0o777, 0o700);

  // Clean up UserB lock
  rmSync(bLockPath, { force: true });
  rmSync('/tmp/b-token.txt', { force: true });
  // Verify UserB parent directory was not rmdir'd
  assert.equal(statSync(`/tmp/yuncms-update-locks-${UID_B}`).isDirectory(), true);

  console.log('✓ All 7 two-user multi-user lock scenarios PASSED.');
} finally {
  rmSync('/tmp/yuncms-update-locks', { recursive: true, force: true });
  rmSync(`/tmp/yuncms-update-locks-${UID_A}`, { recursive: true, force: true });
  rmSync(`/tmp/yuncms-update-locks-${UID_B}`, { recursive: true, force: true });
  rmSync('/tmp/b-token.txt', { force: true });
  rmSync(PROJECT_A, { recursive: true, force: true });
  rmSync(PROJECT_B, { recursive: true, force: true });
}
