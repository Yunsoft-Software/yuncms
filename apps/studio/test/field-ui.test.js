import assert from 'node:assert/strict';
import test from 'node:test';

import {
  fieldCreationPayload,
  fieldDisplayType,
  fileAcceptForField,
  isFileField,
  isImageField,
} from '../src/field-ui.js';

test('file fields use UUID storage with a file interface', () => {
  const payload = fieldCreationPayload({ field: 'attachment', type: 'file', required: false });
  assert.deepEqual(payload, {
    field: 'attachment',
    type: 'uuid',
    required: false,
    interface: 'file',
    options: { preview: true },
  });
  assert.equal(isFileField(payload), true);
  assert.equal(isImageField(payload), false);
  assert.equal(fieldDisplayType(payload), 'file');
  assert.equal(fileAcceptForField(payload), undefined);
});

test('image fields use UUID storage and image-only picker metadata', () => {
  const payload = fieldCreationPayload({ field: 'cover', type: 'image', required: true });
  assert.equal(payload.type, 'uuid');
  assert.equal(payload.interface, 'image');
  assert.deepEqual(payload.options, { accept: 'image/*', preview: true });
  assert.equal(isFileField(payload), true);
  assert.equal(isImageField(payload), true);
  assert.equal(fieldDisplayType(payload), 'image');
  assert.equal(fileAcceptForField(payload), 'image/*');
});

test('normal fields keep their physical type and supported options', () => {
  assert.deepEqual(
    fieldCreationPayload({ field: 'title', type: 'string', required: true, length: 180 }),
    { field: 'title', type: 'string', required: true, length: 180 },
  );
});
