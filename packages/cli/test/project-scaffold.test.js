import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { ensureProjectScaffold } from '../src/project-scaffold.js';

async function isDirectory(path) {
  return (await stat(path)).isDirectory();
}

test('project scaffold creates uploads, Plesk start file and default extensions', async () => {
  const cwd = await mkdtemp(join(tmpdir(), 'yuncms-scaffold-'));

  try {
    const result = await ensureProjectScaffold({ cwd });

    assert.ok(result.created.includes('uploads/'));
    assert.ok(await isDirectory(join(cwd, 'uploads')));
    assert.ok(await isDirectory(join(cwd, 'extensions')));

    const startFile = await readFile(join(cwd, 'start.js'), 'utf8');
    assert.match(startFile, /@yunsoft\/yuncms\/src\/runtime-entry\.js/);

    const healthPackage = JSON.parse(await readFile(join(cwd, 'extensions', 'health', 'package.json'), 'utf8'));
    assert.equal(healthPackage.yuncms.id, 'health');
    assert.equal(healthPackage.yuncms.type, 'endpoint');
    const healthExtension = await readFile(join(cwd, 'extensions', 'health', 'index.js'), 'utf8');
    assert.match(healthExtension, /status\(200\)/);

    const hookPackage = JSON.parse(await readFile(join(cwd, 'extensions', 'example-hook', 'package.json'), 'utf8'));
    assert.equal(hookPackage.yuncms.id, 'example-hook');
    assert.equal(hookPackage.yuncms.type, 'hook');
    const hookExtension = await readFile(join(cwd, 'extensions', 'example-hook', 'index.js'), 'utf8');
    assert.match(hookExtension, /app\.afterStart/);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test('project scaffold preserves existing user files', async () => {
  const cwd = await mkdtemp(join(tmpdir(), 'yuncms-scaffold-existing-'));

  try {
    await ensureProjectScaffold({ cwd });
    await writeFile(join(cwd, 'start.js'), 'custom start\n', 'utf8');
    await writeFile(join(cwd, 'extensions', 'health', 'index.js'), 'custom health\n', 'utf8');

    const result = await ensureProjectScaffold({ cwd });

    assert.deepEqual(result.created, []);
    assert.equal(await readFile(join(cwd, 'start.js'), 'utf8'), 'custom start\n');
    assert.equal(await readFile(join(cwd, 'extensions', 'health', 'index.js'), 'utf8'), 'custom health\n');
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});
