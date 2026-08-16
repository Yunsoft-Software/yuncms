import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { discoverExtensions } from '../src/extensions/discovery.js';
import { validateExtensionManifest } from '../src/extensions/manifest.js';

async function createLocalExtension(root, name, yuncms) {
  const packageRoot = join(root, 'extensions', name);
  await mkdir(join(packageRoot, 'src'), { recursive: true });
  await writeFile(join(packageRoot, 'package.json'), JSON.stringify({ name, type: 'module', yuncms }), 'utf8');
  await writeFile(join(packageRoot, 'src/index.js'), 'export default {};\n', 'utf8');
  return packageRoot;
}

test('manifest accepts endpoint/hook entries inside package root', () => {
  const manifest = validateExtensionManifest({
    name: 'yuncms-extension-orders',
    yuncms: { type: 'endpoint', entry: './src/index.js' },
  }, '/tmp/orders');

  assert.equal(manifest.id, 'orders');
  assert.equal(manifest.type, 'endpoint');
  assert.match(manifest.entry, /orders\/src\/index\.js$/);
});

test('manifest rejects root escapes and unknown types', () => {
  assert.throws(
    () => validateExtensionManifest({
      name: 'unsafe',
      yuncms: { type: 'endpoint', entry: '../outside.js' },
    }, '/tmp/unsafe'),
    (error) => error.code === 'INVALID_EXTENSION_MANIFEST',
  );

  assert.throws(
    () => validateExtensionManifest({
      name: 'graphql',
      yuncms: { type: 'graphql', entry: './index.js' },
    }, '/tmp/graphql'),
    (error) => error.code === 'INVALID_EXTENSION_MANIFEST',
  );
});

test('local discovery returns only packages with a yuncms manifest', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'yuncms-ext-'));
  t.after(() => rm(root, { recursive: true, force: true }));

  await createLocalExtension(root, 'orders-api', {
    id: 'orders',
    type: 'endpoint',
    entry: './src/index.js',
  });
  const ignored = join(root, 'extensions', 'not-an-extension');
  await mkdir(ignored, { recursive: true });
  await writeFile(join(ignored, 'package.json'), JSON.stringify({ name: 'not-an-extension' }), 'utf8');

  const discovered = await discoverExtensions({
    rootDir: root,
    includeDependencies: false,
  });

  assert.equal(discovered.length, 1);
  assert.equal(discovered[0].id, 'orders');
  assert.equal(discovered[0].source, 'local');
});

test('duplicate extension ids fail startup discovery', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'yuncms-ext-'));
  t.after(() => rm(root, { recursive: true, force: true }));

  await createLocalExtension(root, 'a', { id: 'same', type: 'hook', entry: './src/index.js' });
  await createLocalExtension(root, 'b', { id: 'same', type: 'endpoint', entry: './src/index.js' });

  await assert.rejects(
    discoverExtensions({ rootDir: root, includeDependencies: false }),
    (error) => error.code === 'DUPLICATE_EXTENSION_ID',
  );
});
