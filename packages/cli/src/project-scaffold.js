import { access, mkdir, writeFile } from 'node:fs/promises';
import { constants as fsConstants } from 'node:fs';
import { dirname, join } from 'node:path';

const START_FILE = `// Plesk-compatible YunCMS startup file.\n// Install @yunsoft/yuncms locally, then configure Plesk to run: node start.js\nimport('@yunsoft/yuncms/src/runtime-entry.js').catch((error) => {\n  console.error('YunCMS failed to start', error);\n  process.exitCode = 1;\n});\n`;

const HEALTH_PACKAGE = `${JSON.stringify({
  name: 'yuncms-extension-health',
  private: true,
  type: 'module',
  yuncms: {
    id: 'health',
    type: 'endpoint',
    entry: './index.js',
  },
}, null, 2)}\n`;

const HEALTH_EXTENSION = `export default Object.freeze({\n  __yuncms_extension__: true,\n  type: 'endpoint',\n  register(router) {\n    router.get('/', (_req, res) => {\n      res.status(200).json({ status: 'ok' });\n    });\n  },\n});\n`;

const HOOK_PACKAGE = `${JSON.stringify({
  name: 'yuncms-extension-example-hook',
  private: true,
  type: 'module',
  yuncms: {
    id: 'example-hook',
    type: 'hook',
    entry: './index.js',
  },
}, null, 2)}\n`;

const HOOK_EXTENSION = `export default Object.freeze({\n  __yuncms_extension__: true,\n  type: 'hook',\n  register({ init }) {\n    init('app.afterStart', ({ logger }) => {\n      logger.info?.('YunCMS example hook: app.afterStart');\n    });\n  },\n});\n`;

async function pathExists(path) {
  try {
    await access(path, fsConstants.F_OK);
    return true;
  } catch {
    return false;
  }
}

async function ensureDirectory(path, label, created) {
  if (await pathExists(path)) return;
  await mkdir(path, { recursive: true });
  created.push(label);
}

async function writeIfMissing(path, content, label, created) {
  if (await pathExists(path)) return;
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, content, 'utf8');
  created.push(label);
}

export async function ensureProjectScaffold({ cwd = process.cwd() } = {}) {
  const created = [];
  const extensionsDir = join(cwd, 'extensions');
  const uploadsDir = join(cwd, 'uploads');

  await ensureDirectory(extensionsDir, 'extensions/', created);
  await ensureDirectory(uploadsDir, 'uploads/', created);
  await writeIfMissing(join(cwd, 'start.js'), START_FILE, 'start.js', created);

  await writeIfMissing(
    join(extensionsDir, 'health', 'package.json'),
    HEALTH_PACKAGE,
    'extensions/health/package.json',
    created,
  );
  await writeIfMissing(
    join(extensionsDir, 'health', 'index.js'),
    HEALTH_EXTENSION,
    'extensions/health/index.js',
    created,
  );
  await writeIfMissing(
    join(extensionsDir, 'example-hook', 'package.json'),
    HOOK_PACKAGE,
    'extensions/example-hook/package.json',
    created,
  );
  await writeIfMissing(
    join(extensionsDir, 'example-hook', 'index.js'),
    HOOK_EXTENSION,
    'extensions/example-hook/index.js',
    created,
  );

  return Object.freeze({ created: Object.freeze(created) });
}
