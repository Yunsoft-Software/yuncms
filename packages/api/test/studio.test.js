import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';

import { resolveStudioFile } from '../src/studio.js';

test('Studio handler resolves only index and asset paths inside the build root', () => {
  const root = resolve('/tmp/yuncms-studio');

  assert.equal(resolveStudioFile(root, '/'), resolve(root, 'index.html'));
  assert.equal(resolveStudioFile(root, '/assets/app.js'), resolve(root, 'assets/app.js'));
  assert.equal(resolveStudioFile(root, '/health'), null);
  assert.equal(resolveStudioFile(root, '/items/articles'), null);
});

test('Studio asset resolver rejects traversal attempts', () => {
  const root = resolve('/tmp/yuncms-studio');

  assert.equal(resolveStudioFile(root, '/assets/../index.html'), null);
  assert.equal(resolveStudioFile(root, '/assets/%2e%2e/index.html'), null);
  assert.equal(resolveStudioFile(root, '/assets/%E0%A4%A'), null);
});

test('workspace runtime scripts preserve the project cwd for root .env loading', async () => {
  const workspacePackage = JSON.parse(
    await readFile(new URL('../../../package.json', import.meta.url), 'utf8'),
  );

  assert.equal(
    workspacePackage.scripts.start,
    'npm run build:studio && node packages/api/src/server.js',
  );
  assert.equal(workspacePackage.scripts['dev:api'], 'node --watch packages/api/src/server.js');
});

test('Studio uses the shared dialog component instead of native browser dialogs', async () => {
  const studioSource = new URL('../../../apps/studio/src/', import.meta.url);
  const files = [];

  async function collect(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const target = new URL(entry.name, directory);
      if (entry.isDirectory()) await collect(new URL(`${entry.name}/`, directory));
      else if (/\.[jt]sx?$/.test(entry.name)) files.push(target);
    }
  }

  await collect(studioSource);
  const sources = await Promise.all(files.map((file) => readFile(file, 'utf8')));
  assert.ok(sources.some((source) => source.includes('role="dialog"')));
  assert.ok(sources.some((source) => source.includes('<DialogProvider>')));
  for (const source of sources) {
    assert.doesNotMatch(source, /\b(?:window\.)?(?:alert|confirm|prompt)\s*\(/);
  }
});
