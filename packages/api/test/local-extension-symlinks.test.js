import assert from 'node:assert/strict';
import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { discoverExtensions } from '../src/extensions/discovery.js';
import { loadExtensionRuntime } from '../src/extensions/runtime.js';
import { HookEmitter } from '@yunsoft/yuncms-core';

async function fixture(t, manifest = {}) {
  const root = await mkdtemp(join(tmpdir(), 'yuncms-local-link-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const runtime = join(root, 'runtime');
  const packageRoot = join(root, 'workspace-package');
  await mkdir(join(runtime, 'extensions'), { recursive: true });
  await mkdir(packageRoot);
  await writeFile(join(packageRoot, 'package.json'), JSON.stringify({
    name: 'yuncms-extension-linked', type: 'module',
    yuncms: { id: 'linked', type: 'hook', entry: './index.js', ...manifest },
  }));
  await writeFile(join(packageRoot, 'index.js'), `export default {
    __yuncms_extension__: true, type: 'hook',
    register({ filter }) { filter('link.probe', value => value + '-loaded'); },
  };`);
  await symlink(packageRoot, join(runtime, 'extensions', 'linked'), 'dir');
  return { root, runtime, packageRoot };
}

test('local workspace directory links discover and execute a native hook', async (t) => {
  const { runtime, packageRoot } = await fixture(t);
  const extensions = await discoverExtensions({ rootDir: runtime, includeDependencies: false });
  assert.equal(extensions.length, 1);
  assert.equal(extensions[0].packageRoot, await realpath(packageRoot));
  assert.equal(extensions[0].source, 'local');
  const emitter = new HookEmitter();
  const loaded = await loadExtensionRuntime({
    rootDir: runtime, includeDependencies: false, emitter, services: {},
    database: { query: async () => [[], []] }, schemaCache: { get: async () => ({}) },
    logger: { info() {} },
  });
  t.after(() => loaded.stopSchedules());
  assert.equal(await emitter.filter('link.probe', 'value'), 'value-loaded');
});

test('dangling directory links fail explicitly rather than hiding extensions', async (t) => {
  const { root, runtime } = await fixture(t);
  await symlink(join(root, 'absent'), join(runtime, 'extensions', 'broken'), 'dir');
  await assert.rejects(discoverExtensions({ rootDir: runtime, includeDependencies: false }),
    { code: 'INVALID_EXTENSION_PATH' });
});

test('links to files are ignored as non-package entries', async (t) => {
  const { runtime, packageRoot } = await fixture(t);
  await symlink(join(packageRoot, 'package.json'), join(runtime, 'extensions', 'file'));
  assert.equal((await discoverExtensions({ rootDir: runtime, includeDependencies: false })).length, 1);
});

test('duplicate ids through multiple links retain startup rejection', async (t) => {
  const { runtime, packageRoot } = await fixture(t);
  await symlink(packageRoot, join(runtime, 'extensions', 'alias'), 'dir');
  await assert.rejects(discoverExtensions({ rootDir: runtime, includeDependencies: false }),
    { code: 'DUPLICATE_EXTENSION_ID' });
});

test('linked packages still reject lexical and physical entry escapes', async (t) => {
  const { root, runtime, packageRoot } = await fixture(t, { entry: '../outside.js' });
  await writeFile(join(root, 'outside.js'), 'export default {};');
  await assert.rejects(discoverExtensions({ rootDir: runtime, includeDependencies: false }),
    { code: 'INVALID_EXTENSION_MANIFEST' });
  await writeFile(join(packageRoot, 'package.json'), JSON.stringify({
    yuncms: { id: 'linked', type: 'hook', entry: './escape.js' },
  }));
  await symlink(join(root, 'outside.js'), join(packageRoot, 'escape.js'));
  await assert.rejects(discoverExtensions({ rootDir: runtime, includeDependencies: false }),
    { code: 'INVALID_EXTENSION_MANIFEST' });
});

test('linked packages reject missing entries and malformed manifests', async (t) => {
  const { runtime, packageRoot } = await fixture(t, { entry: './missing.js' });
  await assert.rejects(discoverExtensions({ rootDir: runtime, includeDependencies: false }),
    { code: 'INVALID_EXTENSION_MANIFEST' });
  await writeFile(join(packageRoot, 'package.json'), JSON.stringify({ yuncms: { type: 'unknown' } }));
  await assert.rejects(discoverExtensions({ rootDir: runtime, includeDependencies: false }),
    { code: 'INVALID_EXTENSION_MANIFEST' });
});
