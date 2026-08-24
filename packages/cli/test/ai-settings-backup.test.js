import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';

import {
  AI_SETTINGS_KEY_RELATIVE_PATH,
  createProjectBackup,
  restoreProjectBackup,
} from '../src/project-backup.js';

const quietOutput = Object.freeze({ log() {}, warn() {}, error() {} });

async function fakeDump({ outputPath }) {
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, 'fake mysql dump payload');
}

async function fakeVerify() {
  return { decompressedBytes: 23 };
}

test('managed project backup includes the encrypted AI settings key with integrity metadata', async () => {
  const cwd = await mkdtemp(join(tmpdir(), 'yuncms-ai-backup-source-'));
  const keyPath = join(cwd, AI_SETTINGS_KEY_RELATIVE_PATH);
  await mkdir(dirname(keyPath), { recursive: true });
  await writeFile(keyPath, 'test-ai-settings-key\n', { mode: 0o600 });

  const { backupPath, manifest } = await createProjectBackup({
    cwd,
    backupPath: join(cwd, 'snapshot'),
    dumpDatabaseFn: fakeDump,
    verifyDatabaseFn: fakeVerify,
    output: quietOutput,
  });

  assert.equal(manifest.project.aiSettingsKey, true);
  assert.match(manifest.integrity.project.aiSettingsKey, /^[a-f0-9]{64}$/);
  assert.equal(
    await readFile(join(backupPath, 'project', 'ai-settings.key'), 'utf8'),
    'test-ai-settings-key\n',
  );
});

test('managed restore restores the matching AI settings key before the next API startup', async () => {
  const source = await mkdtemp(join(tmpdir(), 'yuncms-ai-backup-source-'));
  const sourceKey = join(source, AI_SETTINGS_KEY_RELATIVE_PATH);
  await mkdir(dirname(sourceKey), { recursive: true });
  await writeFile(sourceKey, 'source-key\n', { mode: 0o600 });

  const { backupPath } = await createProjectBackup({
    cwd: source,
    backupPath: join(source, 'snapshot'),
    dumpDatabaseFn: fakeDump,
    verifyDatabaseFn: fakeVerify,
    output: quietOutput,
  });

  const target = await mkdtemp(join(tmpdir(), 'yuncms-ai-backup-target-'));
  const targetKey = join(target, AI_SETTINGS_KEY_RELATIVE_PATH);
  await mkdir(dirname(targetKey), { recursive: true });
  await writeFile(targetKey, 'wrong-key\n');

  await restoreProjectBackup({
    backupPath,
    cwd: target,
    restoreDatabaseFn: async () => {},
    resetDatabaseFn: async () => {},
    verifyDatabaseFn: fakeVerify,
    output: quietOutput,
  });

  assert.equal(await readFile(targetKey, 'utf8'), 'source-key\n');
});
