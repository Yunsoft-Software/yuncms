import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';

const SRC = resolve(import.meta.dirname, '../src');
const filesSource = readFileSync(resolve(SRC, 'screens/FilesScreen.jsx'), 'utf8');
const inspectorCss = readFileSync(resolve(SRC, 'files-inspector-next.css'), 'utf8');

test('Files opens assets in the shared inspector without replacing the list route', () => {
  assert.match(filesSource, /Inspector,/);
  assert.match(filesSource, /inspectedFile/);
  assert.match(filesSource, /setInspectedFile\(file\)/);
  assert.match(filesSource, /<Inspector/);
  assert.match(filesSource, /studioPath\.file\(fileId\)/);
  assert.match(inspectorCss, /\.file-inspector-preview/);
  assert.match(inspectorCss, /\.file-inspector-meta/);
});

test('Files workspace drag and drop stages a file before upload', () => {
  assert.match(filesSource, /handleLibraryDrop/);
  assert.match(filesSource, /event\.dataTransfer\.files\?\.\[0\]/);
  assert.match(filesSource, /setSelectedFile\(file\)/);
  assert.match(filesSource, /studioPath\.newFile\(\)/);
  assert.match(filesSource, /file-library-drop-overlay/);
  assert.doesNotMatch(filesSource, /handleLibraryDrop[\s\S]{0,400}method:\s*'POST'/);
  assert.match(inspectorCss, /\.file-library-drop-overlay/);
});
