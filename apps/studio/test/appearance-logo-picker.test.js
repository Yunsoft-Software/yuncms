import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';

const SRC = resolve(import.meta.dirname, '../src');
const appearanceSource = readFileSync(resolve(SRC, 'screens/AppearanceScreen.jsx'), 'utf8');
const pickerSource = readFileSync(resolve(SRC, 'components/LogoFilePicker.jsx'), 'utf8');
const brandSource = readFileSync(resolve(SRC, 'components/StudioBrand.jsx'), 'utf8');

test('Appearance uses Files-backed logo selection instead of a URL input', () => {
  assert.match(appearanceSource, /LogoFilePicker/);
  assert.match(appearanceSource, /logo_file/);
  assert.doesNotMatch(appearanceSource, /type="url"/);
  assert.doesNotMatch(appearanceSource, /appearance\.logoUrl/);
});

test('clearing a Files-backed logo restores the Yunsoft fallback even from legacy URL state', () => {
  assert.match(appearanceSource, /function updateLogoFile/);
  assert.match(appearanceSource, /logo_url:\s*fileId \? current\.logo_url : DEFAULT_STUDIO_SETTINGS\.logo_url/);
  assert.match(appearanceSource, /onChange=\{updateLogoFile\}/);
});

test('logo picker loads existing Files, filters images and renders previews', () => {
  assert.match(pickerSource, /apiRequest\('\/files'\)/);
  assert.match(pickerSource, /startsWith\('image\/'\)/);
  assert.match(pickerSource, /<FilePreview/);
  assert.match(pickerSource, /appearance\.searchLogoFiles/);
});

test('file-backed public logo paths resolve against the configured API origin', () => {
  assert.match(brandSource, /import \{ API_URL \} from '\.\.\/api\.js'/);
  assert.match(brandSource, /return `\$\{API_URL\}\$\{value\}`/);
});
