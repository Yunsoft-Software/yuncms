import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';

const SRC = resolve(import.meta.dirname, '../src');
const filesSource = readFileSync(resolve(SRC, 'screens/FilesScreen.jsx'), 'utf8');
const queueSource = readFileSync(resolve(SRC, 'components/UploadQueue.jsx'), 'utf8');
const queueCss = readFileSync(resolve(SRC, 'upload-queue.css'), 'utf8');

test('Files stages multiple files and uploads them with explicit queue states', () => {
  assert.match(filesSource, /type="file" multiple/);
  assert.match(filesSource, /makeQueueItems/);
  assert.match(filesSource, /status: 'queued'/);
  assert.match(filesSource, /status: 'uploading'/);
  assert.match(filesSource, /status: 'done'/);
  assert.match(filesSource, /status: 'failed'/);
  assert.match(filesSource, /for \(const item of targets\)/);
  assert.match(filesSource, /await apiRequest\('\/files'/);
});

test('partial upload failures remain visible and retryable without fake percentages', () => {
  assert.match(filesSource, /item\.status === 'queued' \|\| item\.status === 'failed'/);
  assert.match(filesSource, /files\.uploadPartial/);
  assert.match(filesSource, /hasFailedUploads \? t\('files\.retryFailed'\)/);
  assert.doesNotMatch(filesSource, /progress|percent|percentage/i);
  assert.doesNotMatch(queueSource, /progress|percent|percentage/i);
  assert.match(queueSource, /\['queued', 'failed'\]\.includes\(item\.status\)/);
});

test('UploadQueue is presentation-only and exposes honest state styling', () => {
  assert.doesNotMatch(queueSource, /apiRequest|fetch\(/);
  assert.match(queueCss, /\.status-uploading/);
  assert.match(queueCss, /\.status-done/);
  assert.match(queueCss, /\.status-failed/);
});
