import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';

const SRC = resolve(import.meta.dirname, '../src');
const contentSource = readFileSync(resolve(SRC, 'screens/ContentScreen.jsx'), 'utf8');
const inspectorSource = readFileSync(resolve(SRC, 'components/Inspector.jsx'), 'utf8');
const relationPickerSource = readFileSync(resolve(SRC, 'components/RelationPicker.jsx'), 'utf8');
const workbenchCss = readFileSync(resolve(SRC, 'content-inspector-next.css'), 'utf8');

test('Content quick edit reuses the existing RecordForm inside the shared inspector', () => {
  assert.match(contentSource, /import \{[\s\S]*Inspector,[\s\S]*RelationPicker,[\s\S]*\} from '\.\.\/components\/index\.js';/);
  assert.match(contentSource, /<Inspector/);
  assert.match(contentSource, /<RecordForm[\s\S]*compact/);
  assert.match(contentSource, /onOpenFull=\{\(\) =>/);
  assert.match(inspectorSource, /role="dialog"/);
  assert.match(inspectorSource, /event\.key === 'Escape'/);
  assert.match(inspectorSource, /event\.key !== 'Tab'/);
});

test('Content supports current-page selection and confirmed bulk deletion', () => {
  assert.match(contentSource, /selectedRecordIds/);
  assert.match(contentSource, /allPageSelected/);
  assert.match(contentSource, /togglePageSelection/);
  assert.match(contentSource, /removeSelectedRecords/);
  assert.match(contentSource, /requestConfirmation\(\{/);
  assert.match(contentSource, /content\.bulkDeleteTitle/);
  assert.match(contentSource, /Promise\.allSettled/);
  assert.match(workbenchCss, /\.content-bulk-bar/);
  assert.match(workbenchCss, /\.content-row-selected/);
});

test('relation fields use one searchable picker instead of a native select', () => {
  assert.match(contentSource, /<RelationPicker/);
  assert.match(contentSource, /searchPlaceholder=\{t\('content\.relationSearch'\)\}/);
  assert.match(relationPickerSource, /type="search"/);
  assert.match(relationPickerSource, /role="listbox"/);
  assert.match(relationPickerSource, /aria-selected=\{active\}/);
});

test('unsorted Content columns do not show a decorative bidirectional sort glyph', () => {
  assert.doesNotMatch(contentSource, /['"]↕['"]/);
});
