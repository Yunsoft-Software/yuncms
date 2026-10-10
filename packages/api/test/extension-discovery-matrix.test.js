// Dependency extension discovery matrix tests
// Tracks: https://github.com/Yunsoft-Software/yuncms/issues/40
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { discoverExtensions } from '../src/extensions/discovery.js';

test('direct consumer/node_modules normal scoped package with only ./feature exports returns empty list', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'yuncms-disc-direct-normal-'));
  t.after(() => rm(root, { recursive: true, force: true }));

  await writeFile(
    join(root, 'package.json'),
    JSON.stringify({
      name: 'consumer-app',
      version: '1.0.0',
      dependencies: {
        '@fixture/direct-normal': '1.0.0',
      },
    }),
    'utf8',
  );

  const pkgDir = join(root, 'node_modules', '@fixture', 'direct-normal');
  await mkdir(pkgDir, { recursive: true });
  await writeFile(
    join(pkgDir, 'package.json'),
    JSON.stringify({
      name: '@fixture/direct-normal',
      version: '1.0.0',
      exports: {
        './feature': './feature.js',
      },
    }),
    'utf8',
  );
  await writeFile(join(pkgDir, 'feature.js'), 'export default {};\n', 'utf8');

  const discovered = await discoverExtensions({ rootDir: root });
  assert.deepEqual(discovered, []);
});

test('ancestor/node_modules hoisted scoped normal package with only ./feature exports returns empty list', async (t) => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), 'yuncms-disc-hoisted-normal-'));
  t.after(() => rm(workspaceRoot, { recursive: true, force: true }));

  // Hoisted package in workspace root node_modules
  const pkgDir = join(workspaceRoot, 'node_modules', '@fixture', 'hoisted-normal');
  await mkdir(pkgDir, { recursive: true });
  await writeFile(
    join(pkgDir, 'package.json'),
    JSON.stringify({
      name: '@fixture/hoisted-normal',
      version: '1.0.0',
      exports: {
        './feature': './feature.js',
      },
    }),
    'utf8',
  );
  await writeFile(join(pkgDir, 'feature.js'), 'export default {};\n', 'utf8');

  // Consumer located in a subfolder (apps/consumer)
  const consumerDir = join(workspaceRoot, 'apps', 'consumer');
  await mkdir(consumerDir, { recursive: true });
  await writeFile(
    join(consumerDir, 'package.json'),
    JSON.stringify({
      name: 'consumer-app',
      version: '1.0.0',
      dependencies: {
        '@fixture/hoisted-normal': '1.0.0',
      },
    }),
    'utf8',
  );

  // https://github.com/Yunsoft-Software/yuncms/issues/40
  // Current runtime fails to resolve hoisted dependencies when only ./feature is exported
  const discovered = await discoverExtensions({ rootDir: consumerDir });
  assert.deepEqual(discovered, []);
});

test('ancestor/node_modules hoisted scoped package with valid yuncms hook manifest and only ./feature exports returns npm extension', async (t) => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), 'yuncms-disc-hoisted-hook-'));
  t.after(() => rm(workspaceRoot, { recursive: true, force: true }));

  // Hoisted extension package in workspace root node_modules
  const pkgDir = join(workspaceRoot, 'node_modules', '@fixture', 'hoisted-hook');
  await mkdir(join(pkgDir, 'src'), { recursive: true });
  await writeFile(
    join(pkgDir, 'package.json'),
    JSON.stringify({
      name: '@fixture/hoisted-hook',
      version: '1.0.0',
      exports: {
        './feature': './feature.js',
      },
      yuncms: {
        id: 'hoisted-hook-ext',
        type: 'hook',
        entry: './src/hook.js',
      },
    }),
    'utf8',
  );
  await writeFile(join(pkgDir, 'feature.js'), 'export default {};\n', 'utf8');
  await writeFile(join(pkgDir, 'src', 'hook.js'), 'export default () => {};\n', 'utf8');

  // Consumer located in a subfolder
  const consumerDir = join(workspaceRoot, 'apps', 'consumer');
  await mkdir(consumerDir, { recursive: true });
  await writeFile(
    join(consumerDir, 'package.json'),
    JSON.stringify({
      name: 'consumer-app',
      version: '1.0.0',
      dependencies: {
        '@fixture/hoisted-hook': '1.0.0',
      },
    }),
    'utf8',
  );

  // https://github.com/Yunsoft-Software/yuncms/issues/40
  // Current runtime fails to resolve hoisted dependencies when only ./feature is exported
  const discovered = await discoverExtensions({ rootDir: consumerDir });
  assert.equal(discovered.length, 1);
  assert.equal(discovered[0].id, 'hoisted-hook-ext');
  assert.equal(discovered[0].type, 'hook');
  assert.equal(discovered[0].source, 'npm');
});

test('absent optional dependency returns empty list without error', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'yuncms-disc-absent-optional-'));
  t.after(() => rm(root, { recursive: true, force: true }));

  await writeFile(
    join(root, 'package.json'),
    JSON.stringify({
      name: 'consumer-app',
      version: '1.0.0',
      optionalDependencies: {
        '@fixture/non-existent-optional-pkg': '1.0.0',
      },
    }),
    'utf8',
  );

  const discovered = await discoverExtensions({ rootDir: root });
  assert.deepEqual(discovered, []);
});

test('absent required dependency rejects with EXTENSION_PACKAGE_NOT_RESOLVED', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'yuncms-disc-absent-required-'));
  t.after(() => rm(root, { recursive: true, force: true }));

  await writeFile(
    join(root, 'package.json'),
    JSON.stringify({
      name: 'consumer-app',
      version: '1.0.0',
      dependencies: {
        '@fixture/non-existent-required-pkg': '1.0.0',
      },
    }),
    'utf8',
  );

  await assert.rejects(
    discoverExtensions({ rootDir: root }),
    (error) => error.code === 'EXTENSION_PACKAGE_NOT_RESOLVED',
  );
});

test('direct symlinked scoped package with only ./feature exports is discovered as npm extension', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'yuncms-disc-symlink-'));
  t.after(() => rm(root, { recursive: true, force: true }));

  // Create external package
  const externalDir = join(root, 'external-pkg');
  await mkdir(join(externalDir, 'src'), { recursive: true });
  await writeFile(
    join(externalDir, 'package.json'),
    JSON.stringify({
      name: '@fixture/symlinked-hook',
      version: '1.0.0',
      exports: {
        './feature': './feature.js',
      },
      yuncms: {
        id: 'symlinked-hook-ext',
        type: 'hook',
        entry: './src/hook.js',
      },
    }),
    'utf8',
  );
  await writeFile(join(externalDir, 'feature.js'), 'export default {};\n', 'utf8');
  await writeFile(join(externalDir, 'src', 'hook.js'), 'export default () => {};\n', 'utf8');

  // Consumer package
  const consumerDir = join(root, 'consumer');
  await mkdir(join(consumerDir, 'node_modules', '@fixture'), { recursive: true });
  await writeFile(
    join(consumerDir, 'package.json'),
    JSON.stringify({
      name: 'consumer-app',
      version: '1.0.0',
      dependencies: {
        '@fixture/symlinked-hook': '1.0.0',
      },
    }),
    'utf8',
  );

  // Symlink into consumer node_modules
  await symlink(externalDir, join(consumerDir, 'node_modules', '@fixture', 'symlinked-hook'), 'dir');

  const discovered = await discoverExtensions({ rootDir: consumerDir });
  assert.equal(discovered.length, 1);
  assert.equal(discovered[0].id, 'symlinked-hook-ext');
  assert.equal(discovered[0].type, 'hook');
  assert.equal(discovered[0].source, 'npm');
});

test('ancestor/node_modules hoisted package with invalid yuncms type rejects with INVALID_EXTENSION_MANIFEST', async (t) => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), 'yuncms-disc-hoisted-invalid-type-'));
  t.after(() => rm(workspaceRoot, { recursive: true, force: true }));

  const pkgDir = join(workspaceRoot, 'node_modules', '@fixture', 'hoisted-invalid-type');
  await mkdir(join(pkgDir, 'src'), { recursive: true });
  await writeFile(
    join(pkgDir, 'package.json'),
    JSON.stringify({
      name: '@fixture/hoisted-invalid-type',
      version: '1.0.0',
      exports: {
        './feature': './feature.js',
      },
      yuncms: {
        id: 'invalid-type-ext',
        type: 'unsupported-type',
        entry: './src/index.js',
      },
    }),
    'utf8',
  );
  await writeFile(join(pkgDir, 'feature.js'), 'export default {};\n', 'utf8');
  await writeFile(join(pkgDir, 'src', 'index.js'), 'export default {};\n', 'utf8');

  const consumerDir = join(workspaceRoot, 'apps', 'consumer');
  await mkdir(consumerDir, { recursive: true });
  await writeFile(
    join(consumerDir, 'package.json'),
    JSON.stringify({
      name: 'consumer-app',
      version: '1.0.0',
      dependencies: {
        '@fixture/hoisted-invalid-type': '1.0.0',
      },
    }),
    'utf8',
  );

  await assert.rejects(
    discoverExtensions({ rootDir: consumerDir }),
    (error) => error.code === 'INVALID_EXTENSION_MANIFEST',
  );
});

test('ancestor/node_modules hoisted package with root escaping entry rejects with INVALID_EXTENSION_MANIFEST', async (t) => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), 'yuncms-disc-hoisted-root-escape-'));
  t.after(() => rm(workspaceRoot, { recursive: true, force: true }));

  const pkgDir = join(workspaceRoot, 'node_modules', '@fixture', 'hoisted-root-escape');
  await mkdir(pkgDir, { recursive: true });
  await writeFile(
    join(pkgDir, 'package.json'),
    JSON.stringify({
      name: '@fixture/hoisted-root-escape',
      version: '1.0.0',
      exports: {
        './feature': './feature.js',
      },
      yuncms: {
        id: 'root-escape-ext',
        type: 'hook',
        entry: '../outside.js',
      },
    }),
    'utf8',
  );
  await writeFile(join(pkgDir, 'feature.js'), 'export default {};\n', 'utf8');

  const consumerDir = join(workspaceRoot, 'apps', 'consumer');
  await mkdir(consumerDir, { recursive: true });
  await writeFile(
    join(consumerDir, 'package.json'),
    JSON.stringify({
      name: 'consumer-app',
      version: '1.0.0',
      dependencies: {
        '@fixture/hoisted-root-escape': '1.0.0',
      },
    }),
    'utf8',
  );

  await assert.rejects(
    discoverExtensions({ rootDir: consumerDir }),
    (error) => error.code === 'INVALID_EXTENSION_MANIFEST',
  );
});
