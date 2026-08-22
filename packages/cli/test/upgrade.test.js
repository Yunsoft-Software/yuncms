import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { runCli } from '../src/cli.js';
import { buildDatabaseClientArgs } from '../src/database-backup.js';
import { resetDatabaseObjects } from '../src/database-reset.js';
import {
  createProjectBackup,
  restoreProjectBackup,
} from '../src/project-backup.js';
import { runRestoreCommand } from '../src/restore-command.js';
import { runUpdateCommand } from '../src/update-command.js';

const baseEnv = {
  DB_HOST: '127.0.0.1', DB_PORT: '3306', DB_DATABASE: 'yuncms_test', DB_USER: 'yuncms',
  DB_PASSWORD: 'secret', DB_SSL: 'false', FILES_LOCAL_ROOT: '.yuncms/uploads', PORT: '3008',
};
function silentOutput() { return { log() {}, warn() {}, error() {} }; }
async function fakeMaintenanceLock() { return { async assertHeld() { return true; }, async release() {} }; }

async function createBackupFixture(cwd) {
  await mkdir(join(cwd, '.yuncms', 'backups', 'fixture'), { recursive: true });
  const backupPath = join(cwd, '.yuncms', 'backups', 'fixture');
  const manifest = { format: 1, complete: true, createdAt: '2026-08-22T09:00:00.000Z', database: { host: '127.0.0.1', port: 3306, database: 'yuncms_test', user: 'yuncms', ssl: false, verifiedDecompressedBytes: 1 }, project: { env: true, packageJson: true, packageLock: true, extensions: true, localFiles: true, localFilesRoot: '.yuncms/uploads' }, s3: { configured: false, bucket: null, objectsBackedUp: false } };
  await writeFile(join(backupPath, 'manifest.json'), `${JSON.stringify(manifest)}\n`);
  await writeFile(join(backupPath, 'database.sql.gz'), 'placeholder');
  return { backupPath, manifest };
}

test('database dump arguments never expose the password or request unnecessary routine/event privileges', () => {
  const args = buildDatabaseClientArgs({ host: 'db.internal', port: 3306, database: 'cms', user: 'cms', password: 'top-secret', ssl: true }, { dump: true });
  assert.equal(args.some((arg) => arg.includes('top-secret')), false);
  for (const flag of ['--single-transaction', '--quick', '--hex-blob', '--triggers', '--ssl-mode=REQUIRED']) assert.ok(args.includes(flag));
  assert.equal(args.includes('--routines'), false); assert.equal(args.includes('--events'), false);
});

test('project backup snapshots database marker, env, package metadata, extensions and local files', async () => {
  const cwd = await mkdtemp(join(tmpdir(), 'yuncms-backup-test-'));
  try {
    await mkdir(join(cwd, 'extensions'), { recursive: true }); await mkdir(join(cwd, '.yuncms', 'uploads'), { recursive: true });
    await writeFile(join(cwd, '.env'), 'DB_DATABASE="yuncms_test"\n'); await writeFile(join(cwd, 'package.json'), '{"dependencies":{"@yunsoft/yuncms":"0.1.1"}}\n'); await writeFile(join(cwd, 'package-lock.json'), '{"lockfileVersion":3}\n'); await writeFile(join(cwd, 'extensions', 'example.js'), 'export default {};\n'); await writeFile(join(cwd, '.yuncms', 'uploads', 'asset.txt'), 'asset');
    const result = await createProjectBackup({ cwd, env: baseEnv, now: new Date('2026-08-22T09:00:00.000Z'), output: silentOutput(), async dumpDatabaseFn({ outputPath }) { await writeFile(outputPath, 'fake-gzip'); }, async verifyDatabaseFn() { return { decompressedBytes: 1234 }; } });
    assert.equal(result.manifest.complete, true); assert.equal(result.manifest.database.verifiedDecompressedBytes, 1234); assert.equal(result.manifest.project.env, true); assert.equal(result.manifest.project.packageJson, true); assert.equal(result.manifest.project.packageLock, true); assert.equal(result.manifest.project.extensions, true); assert.equal(result.manifest.project.localFiles, true);
    assert.equal(result.manifest.format, 2); assert.equal(result.manifest.integrity.algorithm, 'sha256'); assert.match(result.manifest.integrity.database, /^[0-9a-f]{64}$/);
    assert.equal(await readFile(join(result.backupPath, 'extensions', 'example.js'), 'utf8'), 'export default {};\n'); assert.equal(await readFile(join(result.backupPath, 'files', 'asset.txt'), 'utf8'), 'asset');
  } finally { await rm(cwd, { recursive: true, force: true }); }
});

test('restore validates backup before resetting database and restores the exact project snapshot', async () => {
  const cwd = await mkdtemp(join(tmpdir(), 'yuncms-restore-test-'));
  try {
    await mkdir(join(cwd, 'extensions'), { recursive: true }); await mkdir(join(cwd, '.yuncms', 'uploads'), { recursive: true });
    await writeFile(join(cwd, '.env'), 'DB_DATABASE="yuncms_test"\n'); await writeFile(join(cwd, 'package.json'), '{"dependencies":{"@yunsoft/yuncms":"0.1.1"}}\n'); await writeFile(join(cwd, 'package-lock.json'), '{"lockfileVersion":3}\n'); await writeFile(join(cwd, 'extensions', 'example.js'), 'old-extension'); await writeFile(join(cwd, '.yuncms', 'uploads', 'asset.txt'), 'old-asset');
    const backup = await createProjectBackup({ cwd, env: baseEnv, output: silentOutput(), async dumpDatabaseFn({ outputPath }) { await writeFile(outputPath, 'fake-gzip'); }, async verifyDatabaseFn() { return { decompressedBytes: 1234 }; } });
    await writeFile(join(cwd, '.env'), 'CHANGED=true\n'); await writeFile(join(cwd, 'package.json'), '{"dependencies":{"@yunsoft/yuncms":"9.9.9"}}\n'); await writeFile(join(cwd, 'extensions', 'example.js'), 'new-extension'); await writeFile(join(cwd, '.yuncms', 'uploads', 'asset.txt'), 'new-asset');
    const sequence = [];
    await restoreProjectBackup({ backupPath: backup.backupPath, cwd, env: baseEnv, output: silentOutput(), async verifyDatabaseFn() { sequence.push('verify'); return { decompressedBytes: 1234 }; }, async resetDatabaseFn() { sequence.push('reset'); }, async restoreDatabaseFn() { sequence.push('restore'); } });
    assert.deepEqual(sequence, ['verify', 'reset', 'restore']); assert.equal(await readFile(join(cwd, 'extensions', 'example.js'), 'utf8'), 'old-extension'); assert.equal(await readFile(join(cwd, '.yuncms', 'uploads', 'asset.txt'), 'utf8'), 'old-asset'); assert.match(await readFile(join(cwd, 'package.json'), 'utf8'), /0\.1\.1/); assert.match(await readFile(join(cwd, '.env'), 'utf8'), /DB_DATABASE/);
  } finally { await rm(cwd, { recursive: true, force: true }); }
});

test('database reset disables FK checks and drops views before tables', async () => {
  const calls = []; let released = false; let closed = false;
  const connection = { async query(sql, params = []) { const normalized = sql.replace(/\s+/g, ' ').trim(); calls.push({ sql: normalized, params }); if (normalized.startsWith('SELECT table_name, table_type')) return [[{ table_name: 'report_view', table_type: 'VIEW' }, { table_name: 'orders', table_type: 'BASE TABLE' }], []]; return [{ affectedRows: 0 }, []]; }, release() { released = true; } };
  const pool = { async getConnection() { return connection; } };
  await resetDatabaseObjects({ config: { database: 'yuncms_test' }, createPool: () => pool, async closePool() { closed = true; } });
  assert.equal(calls[1].sql, 'SET FOREIGN_KEY_CHECKS = 0'); assert.equal(calls[2].sql, 'DROP VIEW IF EXISTS `report_view`'); assert.equal(calls[3].sql, 'DROP TABLE IF EXISTS `orders`'); assert.equal(calls[4].sql, 'SET FOREIGN_KEY_CHECKS = 1'); assert.equal(released, true); assert.equal(closed, true);
});

test('restore command requires explicit destructive confirmation', async () => {
  await assert.rejects(runRestoreCommand({ args: ['./backup'], cwd: '/srv/yuncms', env: baseEnv, output: silentOutput(), async restoreBackup() { throw new Error('must not run'); } }), (error) => error.code === 'RESTORE_CONFIRMATION_REQUIRED');
});

test('CLI routes backup options without weakening argument validation for existing commands', async () => {
  const calls = []; await runCli(['backup', '--output', './safe'], { cwd: '/srv/yuncms', env: baseEnv, output: silentOutput(), async backupCommand(options) { calls.push(options); return { ok: true }; } }); assert.deepEqual(calls[0].args, ['--output', './safe']);
  await assert.rejects(runCli(['start', '--unexpected'], { env: baseEnv, output: silentOutput(), async startCommand() { return { code: 0 }; } }), (error) => error.code === 'INVALID_CLI_ARGUMENTS');
});

test('update dry-run reports safety state without backup, npm install or migrations', async () => {
  let backupCalled = false; let processCalled = false;
  const result = await runUpdateCommand({ args: ['--to', '0.1.2', '--dry-run'], cwd: '/srv/yuncms', env: baseEnv, output: silentOutput(), async collectPreflight() { return { currentVersion: '0.1.1', targetVersion: '0.1.2', upToDate: false, pendingMigrations: ['0013-example'], databaseBytes: 1024, freeDiskBytes: 1024 * 1024 * 1024, s3Configured: false, s3Bucket: null, blockers: [] }; }, async createBackup() { backupCalled = true; }, async runProcess() { processCalled = true; } });
  assert.equal(result.dryRun, true); assert.equal(result.changed, false); assert.equal(backupCalled, false); assert.equal(processCalled, false);
});

test('successful update backs up first, installs exact target, bootstraps and probes readiness', async () => {
  const cwd = await mkdtemp(join(tmpdir(), 'yuncms-update-success-'));
  try {
    const fixture = await createBackupFixture(cwd); const sequence = [];
    const result = await runUpdateCommand({ args: ['--to', '0.1.2'], cwd, env: baseEnv, output: silentOutput(), fetchFn: async () => { throw new Error('connection refused'); }, acquireMaintenanceLock: fakeMaintenanceLock,
      async collectPreflight() { return { currentVersion: '0.1.1', targetVersion: '0.1.2', dependencySection: 'dependencies', upToDate: false, pendingMigrations: ['0013-example'], databaseBytes: 1024, freeDiskBytes: 1024 * 1024 * 1024, s3Configured: false, s3Bucket: null, blockers: [] }; },
      async createBackup() { sequence.push('backup'); return fixture; }, async runProcess(command, args) { sequence.push(args.includes('bootstrap') ? 'bootstrap' : `install:${command}`); return { stdout: '', stderr: '', code: 0 }; }, async verifyRuntime() { sequence.push('probe'); return { ready: true }; } });
    assert.deepEqual(sequence, ['backup', 'install:npm', 'bootstrap', 'probe']); assert.equal(result.changed, true); assert.equal(result.rollbackPerformed, false); assert.equal(result.backupPath, fixture.backupPath);
  } finally { await rm(cwd, { recursive: true, force: true }); }
});

test('failed target migration restores backup, reinstalls old lockfile and verifies rollback runtime', async () => {
  const cwd = await mkdtemp(join(tmpdir(), 'yuncms-update-rollback-'));
  try {
    const fixture = await createBackupFixture(cwd); const sequence = []; let processCount = 0;
    await assert.rejects(runUpdateCommand({ args: ['--to', '0.1.2'], cwd, env: baseEnv, output: silentOutput(), fetchFn: async () => { throw new Error('connection refused'); }, acquireMaintenanceLock: fakeMaintenanceLock,
      async collectPreflight() { return { currentVersion: '0.1.1', targetVersion: '0.1.2', dependencySection: 'dependencies', upToDate: false, pendingMigrations: ['0013-example'], databaseBytes: 1024, freeDiskBytes: 1024 * 1024 * 1024, s3Configured: false, s3Bucket: null, blockers: [] }; },
      async createBackup() { sequence.push('backup'); return fixture; }, async runProcess(_command, args) { processCount += 1; if (processCount === 1) { sequence.push('install'); return { stdout: '', stderr: '', code: 0 }; } if (args.includes('bootstrap')) { sequence.push('bootstrap-fail'); const error = new Error('migration failed'); error.code = 'ER_SIMULATED_DDL'; throw error; } sequence.push(args[0] === 'ci' ? 'npm-ci' : 'npm-install'); return { stdout: '', stderr: '', code: 0 }; },
      async restoreBackup() { sequence.push('restore'); return fixture; }, async verifyRuntime() { sequence.push('rollback-probe'); return { ready: true }; } }),
      (error) => error.code === 'ER_SIMULATED_DDL' && error.rollbackPerformed === true && error.backupPath === fixture.backupPath);
    assert.deepEqual(sequence, ['backup', 'install', 'bootstrap-fail', 'restore', 'npm-ci', 'rollback-probe']);
  } finally { await rm(cwd, { recursive: true, force: true }); }
});
