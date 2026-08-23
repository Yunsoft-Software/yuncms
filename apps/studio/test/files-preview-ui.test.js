import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';

const SRC = resolve(import.meta.dirname, '../src');
const filesSource = readFileSync(resolve(SRC, 'screens/FilesScreen.jsx'), 'utf8');
const previewSource = readFileSync(resolve(SRC, 'components/FilePreview.jsx'), 'utf8');
const css = readFileSync(resolve(SRC, 'asset-picker.css'), 'utf8');
const routedCss = readFileSync(resolve(SRC, 'routed-pages.css'), 'utf8');

test('Files gallery and list open a dedicated routable file detail page', () => {
  assert.match(filesSource, /studioPath\.file\(file\.id\)/);
  assert.match(filesSource, /route\.view === 'detail'/);
  assert.match(filesSource, /file-detail-page/);
  assert.doesNotMatch(filesSource, /FilePreviewModal/);
  assert.doesNotMatch(filesSource, /setPreviewFile/);
});

test('file previews keep the whole media visible on cards and detail pages', () => {
  assert.match(css, /file-preview-open-button[\s\S]*object-fit:\s*contain/);
  assert.match(routedCss, /file-detail-preview[\s\S]*object-fit:\s*contain/);
});

test('full-size preview continues to fetch protected bytes through the authenticated API helper', () => {
  assert.match(previewSource, /apiBlob\(`\/files\/\$\{encodeURIComponent\(file\.id\)\}\/content`\)/);
  assert.match(previewSource, /file-preview-pdf/);
  assert.match(previewSource, /file-preview-video/);
  assert.match(previewSource, /file-preview-audio/);
});
