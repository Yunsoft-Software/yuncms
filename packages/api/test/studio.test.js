import assert from 'node:assert/strict';
import test from 'node:test';
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
