import assert from 'node:assert/strict';
import { mkdtemp, readFile, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { loadOrCreateAiSettingsKey } from '../src/ai/secret-key.js';

test('AI settings key is generated once and reused from the local YunCMS state directory', async () => {
  const cwd = await mkdtemp(join(tmpdir(), 'yuncms-ai-key-'));
  const first = await loadOrCreateAiSettingsKey({ cwd });
  const second = await loadOrCreateAiSettingsKey({ cwd });
  assert.equal(first.created, true);
  assert.equal(second.created, false);
  assert.equal(first.key.length, 32);
  assert.deepEqual(first.key, second.key);
  assert.equal((await readFile(first.path, 'utf8')).trim().length > 0, true);
  if (process.platform !== 'win32') {
    const mode = (await stat(first.path)).mode & 0o777;
    assert.equal(mode, 0o600);
  }
});
