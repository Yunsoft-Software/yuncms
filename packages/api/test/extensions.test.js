import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';

import { HookEmitter } from '@yunsoft/yuncms-core';
import { discoverExtensions } from '../src/extensions/discovery.js';
import { validateExtensionManifest } from '../src/extensions/manifest.js';
import { loadExtensionRuntime } from '../src/extensions/runtime.js';

async function createLocalExtension(root, name, yuncms, source = 'export default {};\n') {
  const packageRoot = join(root, 'extensions', name);
  await mkdir(join(packageRoot, 'src'), { recursive: true });
  await writeFile(join(packageRoot, 'package.json'), JSON.stringify({ name, type: 'module', yuncms }), 'utf8');
  await writeFile(join(packageRoot, 'src/index.js'), source, 'utf8');
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

test('dependency discovery ignores installed packages without root or package-json exports', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'yuncms-ext-dependency-'));
  t.after(() => rm(root, { recursive: true, force: true }));

  await writeFile(join(root, 'package.json'), JSON.stringify({
    name: 'consumer',
    dependencies: { 'non-exporting-package': '1.0.0' },
  }), 'utf8');
  const packageRoot = join(root, 'node_modules', 'non-exporting-package');
  await mkdir(packageRoot, { recursive: true });
  await writeFile(join(packageRoot, 'package.json'), JSON.stringify({
    name: 'non-exporting-package',
    version: '1.0.0',
    exports: { './feature': './feature.js' },
  }), 'utf8');

  assert.deepEqual(await discoverExtensions({ rootDir: root }), []);
});

test('runtime accepts SDK marker and exposes services directly to hooks', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'yuncms-ext-runtime-'));
  t.after(() => {
    delete globalThis.__yuncmsRuntimeProbe;
    return rm(root, { recursive: true, force: true });
  });

  await createLocalExtension(
    root,
    'runtime-probe',
    { id: 'runtime-probe', type: 'hook', entry: './src/index.js' },
    `export default {
      __yuncms_extension__: true,
      type: 'hook',
      register({ init }, context) {
        init('app.beforeStart', async () => {
          const service = new context.services.ProbeService({ database: context.database });
          globalThis.__yuncmsRuntimeProbe = {
            service: await service.read(),
            env: context.env.RUNTIME_PROBE,
          };
        });
      }
    };\n`,
  );

  class ProbeService {
    constructor(options) {
      this.options = options;
    }

    async read() {
      return this.options.database === database ? 'direct-service-context' : 'wrong-context';
    }
  }

  const database = { query: async () => [[], []] };
  const runtime = await loadExtensionRuntime({
    rootDir: root,
    includeDependencies: false,
    services: { ProbeService },
    database,
    schemaCache: { get: async () => ({ version: 1 }) },
    emitter: new HookEmitter(),
    logger: { info() {} },
    env: { RUNTIME_PROBE: 'process-environment' },
  });

  await runtime.init('app.beforeStart');
  assert.deepEqual(globalThis.__yuncmsRuntimeProbe, {
    service: 'direct-service-context',
    env: 'process-environment',
  });
});

test('API server passes the process environment to the extension runtime', async () => {
  const source = await readFile(resolve(import.meta.dirname, '../src/server.js'), 'utf8');

  assert.match(
    source,
    /loadExtensionRuntime\(\{[\s\S]*?env:\s*process\.env,[\s\S]*?\}\)/u,
  );
});
