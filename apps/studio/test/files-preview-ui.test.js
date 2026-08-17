import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';

const SRC = resolve(import.meta.dirname, '../src');
const filesSource = readFileSync(resolve(SRC, 'screens/FilesScreen.jsx'), 'utf8');
const modalSource = readFileSync(resolve(SRC, 'components/FilePreviewModal.jsx'), 'utf8');
const previewSource = readFileSync(resolve(SRC, 'components/FilePreview.jsx'), 'utf8');
const css = readFileSync(resolve(SRC, 'asset-picker.css'), 'utf8');

test('Files gallery and list open a dedicated full-size preview modal', () => {
  assert.match(filesSource, /FilePreviewModal/);
  assert.match(filesSource, /previewFile/);
  assert.match(filesSource, /setPreviewFile\(file\)/);
  assert.match(filesSource, /files\.preview/);
  assert.match(modalSource, /file-preview-full/);
});

test('file previews keep the whole media visible instead of cover-cropping it', () => {
  assert.match(css, /file-preview-open-button[\s\S]*object-fit:\s*contain/);
  assert.match(css, /file-preview-full[\s\S]*object-fit:\s*contain/);
  assert.match(css, /height:\s*min\(72vh, 760px\)/);
});

test('full-size preview continues to fetch protected bytes through the authenticated API helper', () => {
  assert.match(previewSource, /apiBlob\(`\/files\/\$\{encodeURIComponent\(file\.id\)\}\/content`\)/);
  assert.match(previewSource, /file-preview-pdf/);
  assert.match(previewSource, /file-preview-video/);
  assert.match(previewSource, /file-preview-audio/);
});
