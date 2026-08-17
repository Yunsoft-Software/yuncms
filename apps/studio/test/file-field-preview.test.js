import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';

import { filePreviewKind, isPreviewableImage } from '../src/file-preview-kind.js';

const SRC = resolve(import.meta.dirname, '../src');
const control = readFileSync(resolve(SRC, 'components/FileFieldControl.jsx'), 'utf8');
const content = readFileSync(resolve(SRC, 'screens/ContentScreen.jsx'), 'utf8');
const preview = readFileSync(resolve(SRC, 'components/FilePreview.jsx'), 'utf8');

test('file preview classifier recognizes common rich preview types', () => {
  assert.equal(filePreviewKind({ mimetype: 'image/png' }), 'image');
  assert.equal(filePreviewKind({ filename_download: 'report.PDF' }), 'pdf');
  assert.equal(filePreviewKind({ mimetype: 'video/mp4' }), 'video');
  assert.equal(filePreviewKind({ filename_download: 'voice.mp3' }), 'audio');
  assert.equal(filePreviewKind({ mimetype: 'application/zip' }), 'placeholder');
  assert.equal(isPreviewableImage({ filename_download: 'cover.webp' }), true);
});

test('rich preview component uses authenticated blobs for image, PDF, video and audio', () => {
  assert.match(preview, /apiBlob\(`\/files\/\$\{encodeURIComponent\(file\.id\)\}\/content`\)/);
  assert.match(preview, /previewKind === 'pdf'/);
  assert.match(preview, /previewKind === 'video'/);
  assert.match(preview, /previewKind === 'audio'/);
});

test('file field control can select, upload, clear and preview files', () => {
  assert.match(control, /apiRequest\('\/files'/);
  assert.match(control, /FilePreview/);
  assert.match(control, /FileValuePreview/);
  assert.match(control, /fileAcceptForField/);
  assert.match(control, /onChange\(created\.id\)/);
  assert.match(control, /onChange\(''\)/);
});

test('content loads file metadata only when file fields exist and renders previews', () => {
  assert.match(content, /loadedFields\.some\(isFileField\)/);
  assert.match(content, /apiRequest\('\/files'\)/);
  assert.match(content, /<FileFieldControl/);
  assert.match(content, /<FileValuePreview/);
});
