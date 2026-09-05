import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';

const SRC = resolve(import.meta.dirname, '../src');
const filesSource = readFileSync(resolve(SRC, 'screens/FilesScreen.jsx'), 'utf8');
const inspectorCss = readFileSync(resolve(SRC, 'files-inspector-next.css'), 'utf8');
const filesCss = readFileSync(resolve(SRC, 'files-next.css'), 'utf8');

test('Files opens assets in the shared inspector without replacing the list route', () => {
  assert.match(filesSource, /Inspector,/);
  assert.match(filesSource, /inspectedFile/);
  assert.match(filesSource, /setInspectedFile\(file\)/);
  assert.match(filesSource, /<Inspector/);
  assert.match(filesSource, /studioPath\.file\(fileId\)/);
  assert.match(inspectorCss, /\.file-inspector-preview/);
  assert.match(inspectorCss, /\.file-inspector-meta/);
});

test('Files workspace drag and drop stages all dropped files before upload', () => {
  assert.match(filesSource, /handleLibraryDrop/);
  assert.match(filesSource, /const dropped = event\.dataTransfer\.files/);
  assert.match(filesSource, /stageFiles\(dropped\)/);
  assert.match(filesSource, /studioPath\.newFile\(\)/);
  assert.match(filesSource, /file-library-drop-overlay/);
  assert.doesNotMatch(filesSource, /handleLibraryDrop[\s\S]{0,400}method:\s*'POST'/);
  assert.match(inspectorCss, /\.file-library-drop-overlay/);
});

test('the routed upload workspace stacks its heading, dropzone and queue without inheriting the generic split panel', () => {
  assert.match(filesSource, /file-upload-panel file-upload-page/);
  assert.match(filesCss, /\.studio-next-app \.panel\.file-upload-page\s*\{[\s\S]*?display:\s*grid;/);
  assert.match(filesCss, /\.studio-next-app \.panel\.file-upload-page\s*\{[\s\S]*?justify-content:\s*stretch;/);
  assert.match(filesCss, /\.studio-next-app \.file-upload-page > div:first-child\s*\{[\s\S]*?max-width:\s*none;/);
  assert.match(filesCss, /\.file-dropzone\s*\{[\s\S]*?margin-top:\s*0;/);
});
