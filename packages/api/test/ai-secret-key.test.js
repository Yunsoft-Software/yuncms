import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { syncBuiltinESMExports } from 'node:module';
import { mkdtemp, readFile, readdir, rm, stat, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { loadOrCreateAiSettingsKey } from '../src/ai/secret-key.js';

test('AI settings key is generated once and reused from the local YunCMS state directory', async (t) => {
  const cwd = await mkdtemp(join(tmpdir(), 'yuncms-ai-key-'));
  t.after(() => rm(cwd, { recursive: true, force: true }));
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

test('concurrent first-start callers receive one complete key and leave no temporary files', async (t) => {
  for (let round = 0; round < 8; round++) {
    const cwd = await mkdtemp(join(tmpdir(), 'yuncms-ai-key-race-'));
    t.after(() => rm(cwd, { recursive: true, force: true }));
    const results = await Promise.all(Array.from({ length: 24 }, () => loadOrCreateAiSettingsKey({ cwd })));
    assert.equal(results.filter(result => result.created).length, 1);
    for (const result of results) assert.deepEqual(result.key, results[0].key);
    assert.equal(Buffer.from((await readFile(results[0].path, 'utf8')).trim(), 'base64').length, 32);
    assert.deepEqual(await readdir(join(cwd, '.yuncms')), ['ai-settings.key']);
  }
});

test('an existing malformed key fails closed and is never replaced', async (t) => {
  const cwd = await mkdtemp(join(tmpdir(), 'yuncms-ai-key-invalid-'));
  t.after(() => rm(cwd, { recursive: true, force: true }));
  await mkdir(join(cwd, '.yuncms'));
  const path = join(cwd, '.yuncms/ai-settings.key');
  await writeFile(path, 'invalid-key');
  await assert.rejects(loadOrCreateAiSettingsKey({ cwd }), { code: 'AI_SETTINGS_KEY_INVALID' });
  assert.equal(await readFile(path, 'utf8'), 'invalid-key');
});

test('a delayed key write is never published before its contents are complete', async (t) => {
  const cwd = await mkdtemp(join(tmpdir(), 'yuncms-ai-key-delayed-'));
  const original = fs.writeFile;
  const mocked = t.mock.method(fs, 'writeFile', async (path, contents, options) => {
    if (options?.flag !== 'wx') return original(path, contents, options);
    const handle = await fs.open(path, options.flag, options.mode);
    try {
      await new Promise(resolve => setTimeout(resolve, 25));
      await handle.writeFile(contents, options.encoding);
    } finally { await handle.close(); }
  });
  syncBuiltinESMExports();
  t.after(async () => {
    mocked.mock.restore();
    syncBuiltinESMExports();
    await rm(cwd, { recursive: true, force: true });
  });
  const results = await Promise.allSettled(Array.from({ length: 8 }, () => loadOrCreateAiSettingsKey({ cwd })));
  assert.equal(results.every(result => result.status === 'fulfilled'), true,
    'every concurrent loader must observe a complete key, including while the creator is writing');
  assert.equal(results.filter(result => result.value.created).length, 1);
});

test('failed atomic publication removes temporary key material and fails closed', async (t) => {
  const cwd = await mkdtemp(join(tmpdir(), 'yuncms-ai-key-publication-'));
  const mocked = t.mock.method(fs, 'link', async () => {
    throw Object.assign(new Error('permission denied'), { code: 'EACCES' });
  });
  syncBuiltinESMExports();
  t.after(async () => {
    mocked.mock.restore();
    syncBuiltinESMExports();
    await rm(cwd, { recursive: true, force: true });
  });
  await assert.rejects(loadOrCreateAiSettingsKey({ cwd }), { code: 'AI_SETTINGS_KEY_INVALID' });
  assert.deepEqual(await readdir(join(cwd, '.yuncms')), []);
});
