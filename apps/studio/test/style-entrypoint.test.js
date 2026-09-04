import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';

const SRC = resolve(import.meta.dirname, '../src');
const mainSource = readFileSync(resolve(SRC, 'main.jsx'), 'utf8');
const studioCss = readFileSync(resolve(SRC, 'studio.css'), 'utf8');

test('Studio bootstrap loads one stylesheet entry point', () => {
  const cssImports = [...mainSource.matchAll(/import ['"]\.\/[^'"]+\.css['"];?/g)].map((match) => match[0]);
  assert.deepEqual(cssImports, ["import './studio.css';"]);
});

test('Studio stylesheet entry point keeps semantic workbench surfaces centralized', () => {
  for (const stylesheet of [
    'studio-next-tokens.css',
    'content-workbench-next.css',
    'file-category-rail.css',
    'schema-graph.css',
    'access-next.css',
    'rule-builder.css',
    'studio-compat.css',
  ]) {
    assert.match(studioCss, new RegExp(`@import './${stylesheet.replace('.', '\\.')}'`));
  }
  assert.ok(
    studioCss.lastIndexOf("@import './studio-compat.css';") > studioCss.lastIndexOf("@import './auth-settings-next.css';"),
    'compatibility fallbacks should load after semantic/auth surfaces',
  );
});
