import { resolve } from 'node:path';

import { loadConfig } from '@yunsoft/yuncms-core';

import { parseCommandOptions } from './command-options.js';
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
  do {
    current /= 1024;
    unit += 1;
  } while (current >= 1024 && unit < units.length - 1);
  return `${current.toFixed(current >= 10 ? 1 : 2)} ${units[unit]}`;
}

function printPreflight(report, output) {
  output.log?.(`YunCMS update: ${report.currentVersion} -> ${report.targetVersion}`);
  output.log?.(`Database migrations: ${report.pendingMigrations.length > 0 ? report.pendingMigrations.join(', ') : 'none'}`);
  output.log?.(`Estimated database size: ${formatBytes(report.databaseBytes)}`);
  if (report.localBackupBytes != null) output.log?.(`Estimated local backup assets: ${formatBytes(report.localBackupBytes)}`);
  output.log?.(`Free disk: ${formatBytes(report.freeDiskBytes)}`);
  if (report.s3Configured) {
    output.log?.(`S3 storage: ${report.s3Bucket} (provider-side object backup required)`);
  }
  if (report.blockers.length > 0) output.warn?.(`Preflight blockers: ${report.blockers.join(', ')}`);
}

function localCliPath(cwd) {
  return resolve(cwd, 'node_modules', '@yunsoft', 'yuncms', 'bin', 'yuncms.js');
}

async function installVersion({ cwd, env, targetVersion, runProcess }) {
  return runProcess(
    'npm',
    [
      'install',
      '--save-exact',
      '--no-audit',
      '--no-fund',
      `@yunsoft/yuncms@${targetVersion}`,
    ],
    { cwd, env },
  );
}

async function bootstrapInstalledVersion({ cwd, env, runProcess }) {
  return runProcess(
    process.execPath,
    [localCliPath(cwd), 'bootstrap'],
    { cwd, env },
  );
}

async function reinstallBackedUpDependencies({ cwd, env, manifest, runProcess }) {
  const args = manifest.project.packageLock
    ? ['ci', '--no-audit', '--no-fund']
    : ['install', '--no-audit', '--no-fund'];
  return runProcess('npm', args, { cwd, env });
}

function rollbackFailure(originalError, rollbackError) {
  const error = new Error(
    `YunCMS update failed and automatic rollback also failed. Update error: ${originalError.message}. Rollback error: ${rollbackError.message}`,
  );
  error.code = 'UPDATE_ROLLBACK_FAILED';
  error.updateError = originalError;
  error.rollbackError = rollbackError;
  return error;
}

export async function runUpdateCommand({
  args = [],
  cwd = process.cwd(),
  env = process.env,
  output = console,
  runProcess = runCapturedProcess,
  collectPreflight = collectUpdatePreflight,
  createBackup = createProjectBackup,
  restoreBackup = restoreProjectBackup,
  verifyRuntime = verifyInstalledRuntime,
  acquireLock = acquireUpdateLock,
  assertStopped = assertYunCmsStopped,
  fetchFn = globalThis.fetch,
} = {}) {
  const { values } = parseCommandOptions(args, {
    boolean: ['--dry-run', '--allow-unverified-s3'],
    string: ['--to', '--backup-output'],
    maxPositionals: 0,
  });

  const target = values['--to'] ?? 'latest';
  const dryRun = values['--dry-run'] === true;
  const allowUnverifiedS3 = values['--allow-unverified-s3'] === true;
  const config = loadConfig(env);
  const lock = dryRun ? null : await acquireLock({ cwd });

  try {
    const report = await collectPreflight({
      cwd,
      env,
      target,
      allowUnverifiedS3,
      runProcess,
      fetchFn,
    });
    printPreflight(report, output);

    if (report.upToDate) {
      output.log?.('YunCMS is already on the requested version.');
      return { changed: false, dryRun, report, backupPath: null };
    }

    if (dryRun) {
      output.log?.(report.blockers.length === 0 ? 'Dry run passed; no changes were made.' : 'Dry run found blockers; no changes were made.');
      return { changed: false, dryRun: true, report, backupPath: null };
    }

    assertUpdatePreflightReady(report);
    await assertStopped({
      host: config.server.host,
      port: config.server.port,
      fetchFn,
    });

    const backupPath = values['--backup-output']
      ? resolve(cwd, values['--backup-output'])
      : null;
    const backup = await createBackup({ cwd, env, output, backupPath });
    await readBackupManifest(backup.backupPath);

    try {
      output.log?.(`Installing @yunsoft/yuncms@${report.targetVersion}`);
      await installVersion({ cwd, env, targetVersion: report.targetVersion, runProcess });

      await assertStopped({
        host: config.server.host,
        port: config.server.port,
        fetchFn,
      });

      output.log?.('Applying target database migrations');
      await bootstrapInstalledVersion({ cwd, env, runProcess });

      output.log?.('Starting temporary readiness probe');
      await verifyRuntime({
        cwd,
        env,
        port: config.server.port,
        fetchFn,
      });

      output.log?.(`YunCMS update verified: ${report.currentVersion} -> ${report.targetVersion}`);
      output.log?.('The verification process is stopped. Restart YunCMS through your normal service supervisor.');
      return {
        changed: true,
        dryRun: false,
        report,
        backupPath: backup.backupPath,
        rollbackPerformed: false,
      };
    } catch (updateError) {
      output.warn?.(`Update failed; restoring backup ${backup.backupPath}`);
      try {
        const restored = await restoreBackup({
          backupPath: backup.backupPath,
          cwd,
          env,
          output,
        });
        await reinstallBackedUpDependencies({
          cwd,
          env,
          manifest: restored.manifest,
          runProcess,
        });
        await verifyRuntime({
          cwd,
          env,
          port: config.server.port,
          fetchFn,
        });
        updateError.rollbackPerformed = true;
        updateError.backupPath = backup.backupPath;
        updateError.message = `${updateError.message} (automatic rollback completed successfully)`;
        throw updateError;
      } catch (rollbackError) {
        if (rollbackError === updateError) throw updateError;
        throw rollbackFailure(updateError, rollbackError);
      }
    }
  } finally {
    if (lock) await lock.release();
  }
}
