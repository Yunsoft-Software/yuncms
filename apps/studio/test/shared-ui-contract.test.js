import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, extname, join, resolve } from 'node:path';
import test from 'node:test';

const SRC = resolve(import.meta.dirname, '../src');
const COMPONENTS = resolve(SRC, 'components');
const SCREENS = resolve(SRC, 'screens');
const SOURCE_EXTENSIONS = new Set(['.js', '.jsx']);

function sourceFiles(root) {
  return readdirSync(root).flatMap((name) => {
    const path = join(root, name);
    return statSync(path).isDirectory()
      ? sourceFiles(path)
      : SOURCE_EXTENSIONS.has(extname(path)) ? [path] : [];
  });
}

test('Studio source never uses browser-native alert, prompt or confirm dialogs', () => {
  const nativeDialog = /(?:\bwindow\.|\bglobalThis\.)?(?:alert|prompt|confirm)\s*\(/g;
  const violations = [];

  for (const file of sourceFiles(SRC)) {
    const source = readFileSync(file, 'utf8');
    if (nativeDialog.test(source)) violations.push(file.replace(`${SRC}/`, ''));
    nativeDialog.lastIndex = 0;
  }

  assert.deepEqual(violations, [], `Use shared Modal/DialogProvider instead of native browser dialogs: ${violations.join(', ')}`);
});

test('shared component files are exposed from one components entry point', () => {
  const indexSource = readFileSync(resolve(COMPONENTS, 'index.js'), 'utf8');
  const missing = readdirSync(COMPONENTS)
    .filter((name) => name.endsWith('.jsx'))
    .filter((name) => !indexSource.includes(`'./${name}'`));

  assert.deepEqual(missing, [], `Export shared components from components/index.js: ${missing.join(', ')}`);
});

test('Studio consumers use shared UI only through components/index.js', () => {
  const violations = [];
  const directComponentImport = /from\s+['"](?:\.\.\/|\.\/)components\/(?!index\.js)[^'"]+['"]/g;

  for (const file of sourceFiles(SRC).filter((path) => !path.startsWith(`${COMPONENTS}/`))) {
    const source = readFileSync(file, 'utf8');
    if (directComponentImport.test(source)) violations.push(file.replace(`${SRC}/`, ''));
    directComponentImport.lastIndex = 0;
  }

  assert.deepEqual(violations, [], `Import shared UI through components/index.js: ${violations.join(', ')}`);
});

test('screens do not implement their own modal/dialog primitives', () => {
  const violations = [];
  for (const file of sourceFiles(SCREENS)) {
    const source = readFileSync(file, 'utf8');
    if (/createPortal\s*\(/.test(source) || /role=["']dialog["']/.test(source)) {
      violations.push(basename(file));
    }
  }
  assert.deepEqual(violations, [], `Move dialogs into shared components: ${violations.join(', ')}`);
});

test('Studio shell no longer renders the duplicate generic page header', () => {
  const appSource = readFileSync(resolve(SRC, 'App.jsx'), 'utf8');
  assert.match(appSource, /from '\.\/components\/index\.js'/);
  assert.doesNotMatch(appSource, /className="page-header"/);
  assert.doesNotMatch(appSource, /function sectionCopy/);
});

test('Studio bootstrap consumes cross-cutting UI from the shared entry point', () => {
  const mainSource = readFileSync(resolve(SRC, 'main.jsx'), 'utf8');
  assert.match(mainSource, /from '\.\/components\/index\.js'/);
  assert.doesNotMatch(mainSource, /from '\.\/components\/(?:AppRail|DialogProvider)\.jsx'/);
});
