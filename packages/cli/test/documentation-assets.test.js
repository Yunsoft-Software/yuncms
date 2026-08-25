import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';

const root = resolve(import.meta.dirname, '../../..');

test('public documentation screenshots track the current release', () => {
  const workspace = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'));
  const manifest = JSON.parse(readFileSync(resolve(root, 'docs/assets/screenshots/manifest.json'), 'utf8'));
  const readme = readFileSync(resolve(root, 'README.md'), 'utf8');

  assert.equal(manifest.yuncmsVersion, workspace.version);
  assert.ok(Array.isArray(manifest.files));
  assert.ok(manifest.files.length >= 4);

  for (const file of manifest.files) {
    assert.match(file, /\.(?:png|jpe?g|webp|gif)$/i);
    assert.equal(existsSync(resolve(root, 'docs/assets/screenshots', file)), true, `Missing documentation screenshot: ${file}`);
  }

  assert.match(readme, /docs\/assets\/screenshots\/studio-content\.png/);
  assert.match(readme, /docs\/assets\/screenshots\/studio-data-model\.png/);
});
