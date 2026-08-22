import { resolve } from 'node:path';

import { loadConfig } from '@yunsoft/yuncms-core';

import { parseCommandOptions } from './command-options.js';
import { acquireDatabaseMaintenanceLock } from './maintenance-lock.js';
import {
  createProjectBackup,
  readBackupManifest,
  restoreProjectBackup,
} from './project-backup.js';
import { runCapturedProcess } from './process-runner.js';
import { verifyInstalledRuntime } from './runtime-probe.js';
import { assertYunCmsStopped } from './service-state.js';
import {
  assertUpdatePreflightReady,
  collectUpdatePreflight,
} from './update-preflight.js';
import { acquireUpdateLock } from './update-lock.js';

function formatBytes(value) {
  const bytes = Number(value) || 0;
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let current = bytes;
  let unit = -1;
  do { current /= 1024; unit += 1; } while (current >= 1024 && unit < units.length - 1);
  return `${current.toFixed(current >= 10 ? 1 : 2)} ${units[unit]}`;
}
function printPreflight(report, output) {
  output.log?.(`YunCMS update: ${report.currentVersion} -> ${report.targetVersion}`);
  output.log?.(`Database migrations: ${report.pendingMigrations.length > 0 ? report.pendingMigrations.join(', ') : 'none'}`);
  output.log?.(`Estimated database size: ${formatBytes(report.databaseBytes)}`);
  if (report.localBackupBytes != null) output.log?.(`Estimated local backup assets: ${formatBytes(report.localBackupBytes)}`);
  output.log?.(`Free disk: ${formatBytes(report.freeDiskBytes)}`);
  if (report.s3Configured) output.log?.(`S3 storage: ${report.s3Bucket} (provider-side object backup required)`);
  if (report.blockers.length > 0) output.warn?.(`Preflight blockers: ${report.blockers.join(', ')}`);
}
function localCliPath(cwd) { return resolve(cwd, 'node_modules', '@yunsoft', 'yuncms', 'bin', 'yuncms.js'); }
function dependencySaveArgs(dependencySection = 'dependencies') {
  if (dependencySection === 'dependencies') return [];
  if (dependencySection === 'devDependencies') return ['--save-dev'];
  if (dependencySection === 'optionalDependencies') return ['--save-optional'];
  const error = new Error(`Unsupported YunCMS dependency section: ${dependencySection}`); error.code = 'UPDATE_DEPENDENCY_SECTION_INVALID'; throw error;
}
function assertLockContract(lock) {
  if (!lock || typeof lock.assertHeld !== 'function' || typeof lock.release !== 'function') {
    const error = new Error('Database maintenance lock implementation is invalid'); error.code = 'DATABASE_MAINTENANCE_LOCK_INVALID'; throw error;
  }
  return lock;
}
function databaseStateRequiresAttention(report) {
  return (report.pendingMigrations?.length ?? 0) > 0
    || (report.unknownAppliedMigrations?.length ?? 0) > 0
    || (report.migrationHistoryGap?.length ?? 0) > 0
    || (report.incompleteMigrationAttempts?.length ?? 0) > 0;
}
async function installVersion({ cwd, env, targetVersion, dependencySection, runProcess }) {
  return runProcess('npm', ['install', '--save-exact', ...dependencySaveArgs(dependencySection), '--no-audit', '--no-fund', `@yunsoft/yuncms@${targetVersion}`], { cwd, env });
}
async function bootstrapInstalledVersion({ cwd, env, runProcess }) { return runProcess(process.execPath, [localCliPath(cwd), 'bootstrap'], { cwd, env }); }
async function reinstallBackedUpDependencies({ cwd, env, manifest, runProcess }) {
  return runProcess('npm', manifest.project.packageLock ? ['ci', '--no-audit', '--no-fund'] : ['install', '--no-audit', '--no-fund'], { cwd, env });
}
function rollbackFailure(originalError, rollbackError) {
  const error = new Error(`YunCMS update failed and automatic rollback also failed. Update error: ${originalError.message}. Rollback error: ${rollbackError.message}`);
  error.code = 'UPDATE_ROLLBACK_FAILED'; error.updateError = originalError; error.rollbackError = rollbackError; return error;
}

export async function runUpdateCommand({
  args = [], cwd = process.cwd(), env = process.env, output = console,
  runProcess = runCapturedProcess, collectPreflight = collectUpdatePreflight,
  createBackup = createProjectBackup, restoreBackup = restoreProjectBackup,
  verifyRuntime = verifyInstalledRuntime, acquireLock = acquireUpdateLock,
  acquireMaintenanceLock = acquireDatabaseMaintenanceLock, assertStopped = assertYunCmsStopped,
  fetchFn = globalThis.fetch,
} = {}) {
  const { values } = parseCommandOptions(args, { boolean: ['--dry-run', '--allow-unverified-s3'], string: ['--to', '--backup-output'], maxPositionals: 0 });
  const target = values['--to'] ?? 'latest'; const dryRun = values['--dry-run'] === true; const allowUnverifiedS3 = values['--allow-unverified-s3'] === true;
  const config = loadConfig(env); const lock = dryRun ? null : await acquireLock({ cwd }); let maintenanceLock = null;
  const assertServiceStopped = () => assertStopped({ host: config.server.host, port: config.server.port, fetchFn });
  const assertMaintenanceHeld = async () => maintenanceLock ? maintenanceLock.assertHeld() : true;

  try {
    if (!dryRun) maintenanceLock = assertLockContract(await acquireMaintenanceLock({ env }));
    const report = await collectPreflight({ cwd, env, target, allowUnverifiedS3, runProcess, fetchFn });
    printPreflight(report, output);

    if (report.upToDate && !databaseStateRequiresAttention(report)) {
      output.log?.('YunCMS package and database are already on the requested version.');
      return { changed: false, dryRun, report, backupPath: null };
    }
    if (dryRun) {
      output.log?.(report.blockers.length === 0 ? 'Dry run passed; no changes were made.' : 'Dry run found blockers; no changes were made.');
      return { changed: false, dryRun: true, report, backupPath: null };
    }

    assertUpdatePreflightReady(report); await assertServiceStopped(); await assertMaintenanceHeld();
    const backupPath = values['--backup-output'] ? resolve(cwd, values['--backup-output']) : null;
    const backup = await createBackup({ cwd, env, output, backupPath }); await readBackupManifest(backup.backupPath); await assertMaintenanceHeld();

    try {
      output.log?.(`Installing @yunsoft/yuncms@${report.targetVersion}`);
      await installVersion({ cwd, env, targetVersion: report.targetVersion, dependencySection: report.dependencySection, runProcess });
      await assertServiceStopped(); await assertMaintenanceHeld();
      output.log?.('Applying target database migrations'); await bootstrapInstalledVersion({ cwd, env, runProcess }); await assertMaintenanceHeld();
      output.log?.('Starting temporary readiness probe'); await verifyRuntime({ cwd, env, port: config.server.port, fetchFn });
      output.log?.(`YunCMS update verified: ${report.currentVersion} -> ${report.targetVersion}`);
      output.log?.('The verification process is stopped. Restart YunCMS through your normal service supervisor.');
      return { changed: true, dryRun: false, report, backupPath: backup.backupPath, rollbackPerformed: false };
    } catch (updateError) {
      output.warn?.(`Update failed; restoring backup ${backup.backupPath}`);
      try {
        const beforeDestructive = async () => { await assertServiceStopped(); await assertMaintenanceHeld(); };
        const restored = await restoreBackup({ backupPath: backup.backupPath, cwd, env, output, beforeDestructive });
        await reinstallBackedUpDependencies({ cwd, env, manifest: restored.manifest, runProcess }); await assertMaintenanceHeld();
        await verifyRuntime({ cwd, env, port: config.server.port, fetchFn });
        updateError.rollbackPerformed = true; updateError.backupPath = backup.backupPath;
        updateError.message = `${updateError.message} (automatic rollback completed successfully)`; throw updateError;
      } catch (rollbackError) {
        if (rollbackError === updateError) throw updateError;
        throw rollbackFailure(updateError, rollbackError);
      }
    }
  } finally {
    if (maintenanceLock) await maintenanceLock.release();
    if (lock) await lock.release();
  }
}
