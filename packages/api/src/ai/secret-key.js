import { randomBytes, randomUUID } from 'node:crypto';
import { link, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

const KEY_BYTES = 32;
const DEFAULT_KEY_PATH = '.yuncms/ai-settings.key';

function keyError(message, cause = null) {
  const error = new Error(message);
  error.code = 'AI_SETTINGS_KEY_INVALID';
  if (cause) error.cause = cause;
  return error;
}

function decodeKey(contents) {
  const normalized = String(contents ?? '').trim();
  let key;
  try {
    key = Buffer.from(normalized, 'base64');
  } catch (error) {
    throw keyError('YunCMS AI settings key is invalid', error);
  }
  if (key.length !== KEY_BYTES) throw keyError('YunCMS AI settings key must contain 32 bytes');
  return key;
}

async function readExisting(path) {
  try {
    return decodeKey(await readFile(path, 'utf8'));
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    if (error?.code === 'AI_SETTINGS_KEY_INVALID') throw error;
    throw keyError('YunCMS AI settings key could not be read', error);
  }
}

export async function loadOrCreateAiSettingsKey({ cwd = process.cwd(), path = DEFAULT_KEY_PATH } = {}) {
  const absolutePath = resolve(cwd, path);
  const existing = await readExisting(absolutePath);
  if (existing) return { key: existing, path: absolutePath, created: false };

  await mkdir(dirname(absolutePath), { recursive: true, mode: 0o700 });
  const generated = randomBytes(KEY_BYTES);
  const encoded = `${generated.toString('base64')}\n`;
  const temporaryPath = `${absolutePath}.${randomUUID()}.tmp`;

  try {
    await writeFile(temporaryPath, encoded, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
    // Publish complete contents atomically without replacing a competing creator's key.
    await link(temporaryPath, absolutePath);
    return { key: generated, path: absolutePath, created: true };
  } catch (error) {
    if (error?.code !== 'EEXIST') throw keyError('YunCMS AI settings key could not be created', error);
    const raced = await readExisting(absolutePath);
    if (!raced) throw keyError('YunCMS AI settings key disappeared during creation');
    return { key: raced, path: absolutePath, created: false };
  } finally {
    await rm(temporaryPath, { force: true });
  }
}

export { DEFAULT_KEY_PATH, KEY_BYTES, decodeKey };
