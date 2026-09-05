import assert from 'node:assert/strict';
import test from 'node:test';

import { STUDIO_LOCALE_CODES } from '../../../packages/core/src/studio-locales.js';
import { DICTIONARIES } from '../src/localization.js';
import { SUPPORTED_LOCALES } from '../src/locale-registry.js';

test('Studio frontend and core accept the exact same locale codes', () => {
  assert.deepEqual(SUPPORTED_LOCALES, STUDIO_LOCALE_CODES);
});

test('every backend-supported Studio locale has a frontend dictionary', () => {
  assert.deepEqual(Object.keys(DICTIONARIES), STUDIO_LOCALE_CODES);
});
