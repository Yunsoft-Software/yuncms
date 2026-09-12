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
    assert.match(introduction, new RegExp(YUNSOFT_LINK.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
});

test('production mail and MCP dependencies stay above audited security baselines', async () => {
  const [coreManifest, lockfile] = await Promise.all([
    readFile(resolve(PACKAGES_ROOT, 'core/package.json'), 'utf8').then(JSON.parse),
    readFile(resolve(PACKAGES_ROOT, '../package-lock.json'), 'utf8').then(JSON.parse),
  ]);

  assert.equal(coreManifest.dependencies.nodemailer, '9.1.1');
  assert.equal(lockfile.packages['node_modules/nodemailer'].version, '9.1.1');
  assert.equal(lockfile.packages['node_modules/hono'].version, '4.13.7');
});
