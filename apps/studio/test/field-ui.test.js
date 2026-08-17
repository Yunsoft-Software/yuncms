import assert from 'node:assert/strict';
import test from 'node:test';

import {
  fieldCreationPayload,
  fieldDisplayType,
  fileAcceptForField,
  isFileField,
  isImageField,
} from '../src/field-ui.js';

test('file fields keep human labels while using UUID storage with a file interface', () => {
  const payload = fieldCreationPayload({ name: 'Ek Dosya', field: 'ek_dosya', type: 'file', required: false });
  assert.deepEqual(payload, {
    name: 'Ek Dosya',
    field: 'ek_dosya',
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
  const payload = fieldCreationPayload({ name: 'Kapak Görseli', field: 'kapak_gorseli', type: 'image', required: true });
  assert.equal(payload.name, 'Kapak Görseli');
  assert.equal(payload.field, 'kapak_gorseli');
  assert.equal(payload.type, 'uuid');
  assert.equal(payload.interface, 'image');
  assert.deepEqual(payload.options, { accept: 'image/*', preview: true });
  assert.equal(isFileField(payload), true);
  assert.equal(isImageField(payload), true);
  assert.equal(fieldDisplayType(payload), 'image');
  assert.equal(fileAcceptForField(payload), 'image/*');
});

test('normal fields keep separate display name, API key and physical options', () => {
  assert.deepEqual(
    fieldCreationPayload({ name: 'Ürün Başlığı', field: 'urun_basligi', type: 'string', required: true, length: 180 }),
    { name: 'Ürün Başlığı', field: 'urun_basligi', type: 'string', required: true, length: 180 },
  );
});
