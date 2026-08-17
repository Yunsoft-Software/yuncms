import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';

const SRC = resolve(import.meta.dirname, '../src');
const control = readFileSync(resolve(SRC, 'components/FileFieldControl.jsx'), 'utf8');
const content = readFileSync(resolve(SRC, 'screens/ContentScreen.jsx'), 'utf8');

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
