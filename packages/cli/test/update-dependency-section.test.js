import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { runUpdateCommand } from '../src/update-command.js';
import { readProjectPackageState } from '../src/update-preflight.js';

const env = {
  DB_DATABASE: 'yuncms_test',
  DB_USER: 'yuncms',
  DB_PASSWORD: 'secret',
  HOST: '127.0.0.1',
  PORT: '3008',
};

function silentOutput() {
  return { log() {}, warn() {}, error() {} };
}

async function fakeMaintenanceLock() {
  return { async release() {} };
}

async function createInstalledProject(cwd, section) {
  await mkdir(join(cwd, 'node_modules', '@yunsoft', 'yuncms'), { recursive: true });
  await writeFile(
    join(cwd, 'package.json'),
    `${JSON.stringify({ [section]: { '@yunsoft/yuncms': '0.1.0' } }, null, 2)}\n`,
  );
  await writeFile(
    join(cwd, 'node_modules', '@yunsoft', 'yuncms', 'package.json'),
    '{"name":"@yunsoft/yuncms","version":"0.1.0"}\n',
  );
}

async function createBackupFixture(cwd) {
  const backupPath = join(cwd, 'backup');
  await mkdir(backupPath, { recursive: true });
  const manifest = {
    format: 1,
    complete: true,
    createdAt: '2026-08-22T09:00:00.000Z',
    database: {
      host: '127.0.0.1',
      port: 3306,
      database: 'yuncms_test',
      user: 'yuncms',
      ssl: false,
      verifiedDecompressedBytes: 1,
    },
    project: {
      env: false,
      packageJson: false,
      packageLock: false,
      extensions: false,
      localFiles: false,
      localFilesRoot: '.yuncms/uploads',
    },
    s3: { configured: false, bucket: null, objectsBackedUp: false },
  };
  await writeFile(join(backupPath, 'manifest.json'), `${JSON.stringify(manifest)}\n`);
  await writeFile(join(backupPath, 'database.sql.gz'), 'placeholder');
  return { backupPath, manifest };
}

test('preflight package state preserves the existing YunCMS dependency section', async () => {
  for (const section of ['dependencies', 'devDependencies', 'optionalDependencies']) {
    const cwd = await mkdtemp(join(tmpdir(), `yuncms-section-${section}-`));
    try {
      await createInstalledProject(cwd, section);
      const state = await readProjectPackageState(cwd);
      assert.equal(state.currentVersion, '0.1.0');
      assert.equal(state.dependencySection, section);
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  }
});

test('preflight rejects YunCMS declared in multiple dependency sections', async () => {
  const cwd = await mkdtemp(join(tmpdir(), 'yuncms-section-ambiguous-'));
  try {
    await mkdir(join(cwd, 'node_modules', '@yunsoft', 'yuncms'), { recursive: true });
    await writeFile(
      join(cwd, 'package.json'),
      `${JSON.stringify({
        dependencies: { '@yunsoft/yuncms': '0.1.0' },
        devDependencies: { '@yunsoft/yuncms': '0.1.0' },
      }, null, 2)}\n`,
    );
    await writeFile(
      join(cwd, 'node_modules', '@yunsoft', 'yuncms', 'package.json'),
      '{"name":"@yunsoft/yuncms","version":"0.1.0"}\n',
    );

    await assert.rejects(
      readProjectPackageState(cwd),
      (error) => error.code === 'UPDATE_PROJECT_DEPENDENCY_AMBIGUOUS'
        && error.dependencySections.includes('dependencies')
        && error.dependencySections.includes('devDependencies'),
    );
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test('managed update passes the matching npm save mode for dev and optional dependencies', async () => {
  for (const [section, expectedFlag] of [
    ['devDependencies', '--save-dev'],
    ['optionalDependencies', '--save-optional'],
  ]) {
    const cwd = await mkdtemp(join(tmpdir(), `yuncms-update-${section}-`));
    try {
      const backup = await createBackupFixture(cwd);
      const calls = [];
      await runUpdateCommand({
        args: ['--to', '0.2.0'],
        cwd,
        env,
        output: silentOutput(),
        async acquireLock() {
          return { async release() {} };
        },
        acquireMaintenanceLock: fakeMaintenanceLock,
        async assertStopped() { return true; },
        async collectPreflight() {
          return {
            currentVersion: '0.1.0',
            targetVersion: '0.2.0',
            dependencySection: section,
            upToDate: false,
            pendingMigrations: [],
            databaseBytes: 1,
            localBackupBytes: 1,
            freeDiskBytes: 1024 * 1024 * 1024,
            s3Configured: false,
            s3Bucket: null,
            blockers: [],
          };
        },
        async createBackup() { return backup; },
        async runProcess(command, args) {
          calls.push({ command, args: [...args] });
          return { stdout: '', stderr: '', code: 0 };
        },
        async verifyRuntime() { return { ready: true }; },
      });

      const install = calls.find((call) => call.command === 'npm' && call.args[0] === 'install');
      assert.ok(install);
      assert.ok(install.args.includes('--save-exact'));
      assert.ok(install.args.includes(expectedFlag));
      assert.ok(install.args.includes('@yunsoft/yuncms@0.2.0'));
      const otherFlag = expectedFlag === '--save-dev' ? '--save-optional' : '--save-dev';
      assert.equal(install.args.includes(otherFlag), false);
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  }
});
