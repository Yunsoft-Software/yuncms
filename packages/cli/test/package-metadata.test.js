import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import test from 'node:test';

const PACKAGES_ROOT = resolve(import.meta.dirname, '../..');
const PUBLIC_PACKAGES = ['cli', 'api', 'core', 'extensions-sdk'];
const YUNSOFT_LINK = '[Yunsoft Software](https://yunsoft.com)';

test('published package metadata and README introductions link to Yunsoft', async () => {
  for (const packageDirectory of PUBLIC_PACKAGES) {
    const packageRoot = resolve(PACKAGES_ROOT, packageDirectory);
    const manifest = JSON.parse(await readFile(resolve(packageRoot, 'package.json'), 'utf8'));
    const readme = await readFile(resolve(packageRoot, 'README.md'), 'utf8');
    const introduction = readme.split('\n## ')[0];

    assert.equal(manifest.homepage, 'https://yunsoft.com', `${manifest.name} homepage`);
    assert.equal(manifest.funding.type, 'github');
    assert.equal(manifest.funding.url, 'https://github.com/sponsors/Yunsoft-Software');
    assert.match(introduction, new RegExp(YUNSOFT_LINK.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
});

test('GitHub funding button leads to the active organization Sponsors profile', async () => {
  const funding = await readFile(resolve(PACKAGES_ROOT, '../.github/FUNDING.yml'), 'utf8');
  assert.match(funding, /^github: \[Yunsoft-Software\]$/m);
});

test('runtime and Studio dependencies stay above audited security baselines', async () => {
  const [coreManifest, lockfile, apiManifest, studioManifest] = await Promise.all([
    readFile(resolve(PACKAGES_ROOT, 'core/package.json'), 'utf8').then(JSON.parse),
    readFile(resolve(PACKAGES_ROOT, '../package-lock.json'), 'utf8').then(JSON.parse),
    readFile(resolve(PACKAGES_ROOT, 'api/package.json'), 'utf8').then(JSON.parse),
    readFile(resolve(PACKAGES_ROOT, '../apps/studio/package.json'), 'utf8').then(JSON.parse),
  ]);

  assert.equal(coreManifest.dependencies.nodemailer, '10.0.13');
  assert.equal(lockfile.packages['node_modules/nodemailer'].version, '10.0.13');
  assert.equal(lockfile.packages['node_modules/hono'].version, '4.13.7');
  assert.equal(apiManifest.dependencies['proxy-addr'], '2.0.8');
  assert.equal(lockfile.packages['node_modules/proxy-addr'].version, '2.0.8');
  assert.equal(studioManifest.devDependencies['source-map-js'], '1.2.2');
  assert.equal(lockfile.packages['node_modules/source-map-js'].version, '1.2.2');
});

test('release verification serializes integration files that share the MySQL fixture', async () => {
  const verifySource = await readFile(resolve(PACKAGES_ROOT, '../scripts/verify.mjs'), 'utf8');

  assert.match(
    verifySource,
    /real MySQL\/API integration suite[\s\S]*?\{ concurrency: 1 \}/,
  );
});

test('release workspace versions, native dependencies and Docker defaults stay aligned', async () => {
  const root = resolve(PACKAGES_ROOT, '..');
  const manifest = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8'));
  for (const directory of [...PUBLIC_PACKAGES.map(name => `packages/${name}`), 'apps/studio']) {
    const current = JSON.parse(await readFile(resolve(root, directory, 'package.json'), 'utf8'));
    assert.equal(current.version, manifest.version, current.name);
    for (const [name, version] of Object.entries(current.dependencies ?? {})) {
      if (name.startsWith('@yunsoft/yuncms')) assert.equal(version, manifest.version, `${current.name} -> ${name}`);
    }
  }
  const expectedImage = `yunsoftofficial/yuncms:${manifest.version}`;
  for (const file of ['compose.yaml', 'docker.env.example']) {
    assert.ok((await readFile(resolve(root, file), 'utf8')).includes(expectedImage), file);
  }
  const lock = JSON.parse(await readFile(resolve(root, 'package-lock.json'), 'utf8'));
  assert.equal(lock.version, manifest.version);
  for (const directory of ['packages/core', 'packages/api', 'packages/cli', 'packages/extensions-sdk', 'apps/studio']) {
    assert.equal(lock.packages[directory].version, manifest.version, directory);
  }
});
