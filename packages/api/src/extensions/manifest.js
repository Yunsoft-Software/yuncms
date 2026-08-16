import { resolve, sep } from 'node:path';

const TYPES = new Set(['endpoint', 'hook']);
const ID_PATTERN = /^[a-z0-9][a-z0-9_-]{0,63}$/;

function extensionError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function defaultId(packageName) {
  const raw = String(packageName ?? '').split('/').at(-1)?.toLowerCase() ?? '';
  return raw.replace(/^yuncms-extension-/, '').replace(/[^a-z0-9_-]/g, '-');
}

export function validateExtensionManifest(packageJson, packageRoot) {
  if (!packageJson || typeof packageJson !== 'object') {
    throw extensionError('INVALID_EXTENSION_MANIFEST', 'Extension package.json must be an object');
  }
  if (!packageJson.yuncms || typeof packageJson.yuncms !== 'object' || Array.isArray(packageJson.yuncms)) {
    return null;
  }

  const manifest = packageJson.yuncms;
  const type = manifest.type;
  if (!TYPES.has(type)) {
    throw extensionError(
      'INVALID_EXTENSION_MANIFEST',
      `Extension ${packageJson.name ?? '<unnamed>'} has unsupported type: ${String(type)}`,
    );
  }

  const id = String(manifest.id ?? defaultId(packageJson.name));
  if (!ID_PATTERN.test(id)) {
    throw extensionError(
      'INVALID_EXTENSION_MANIFEST',
      `Extension id must match ${ID_PATTERN}: ${id}`,
    );
  }

  if (typeof manifest.entry !== 'string' || manifest.entry.trim() === '') {
    throw extensionError(
      'INVALID_EXTENSION_MANIFEST',
      `Extension ${id} requires a yuncms.entry path`,
    );
  }

  const root = resolve(packageRoot);
  const entry = resolve(root, manifest.entry);
  if (entry !== root && !entry.startsWith(`${root}${sep}`)) {
    throw extensionError(
      'INVALID_EXTENSION_MANIFEST',
      `Extension ${id} entry escapes its package root`,
    );
  }

  return Object.freeze({
    id,
    type,
    entry,
    packageName: packageJson.name ?? id,
    packageRoot: root,
  });
}
