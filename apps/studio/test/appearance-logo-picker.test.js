import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';

const SRC = resolve(import.meta.dirname, '../src');
const appearanceSource = readFileSync(resolve(SRC, 'screens/AppearanceScreen.jsx'), 'utf8');
const assetPickerSource = readFileSync(resolve(SRC, 'components/BrandAssetPicker.jsx'), 'utf8');
const modalPickerSource = readFileSync(resolve(SRC, 'components/FilePickerModal.jsx'), 'utf8');
const brandSource = readFileSync(resolve(SRC, 'components/StudioBrand.jsx'), 'utf8');
const settingsSource = readFileSync(resolve(SRC, 'studio-settings.js'), 'utf8');

test('Appearance selects logo and favicon from Files rather than URL inputs', () => {
  assert.match(appearanceSource, /BrandAssetPicker/);
  assert.match(appearanceSource, /kind="logo"/);
  assert.match(appearanceSource, /kind="favicon"/);
  assert.match(appearanceSource, /logo_file/);
  assert.match(appearanceSource, /favicon_file/);
  assert.doesNotMatch(appearanceSource, /type="url"/);
});

test('branding settings stay compact until the Files modal is opened', () => {
  assert.match(assetPickerSource, /FilePickerModal/);
  assert.match(assetPickerSource, /appearance\.selectFromFiles/);
  assert.doesNotMatch(appearanceSource, /\.map\(\(file\)/);
});

test('Files asset modal filters images, searches and paginates 12 items at a time', () => {
  assert.match(modalPickerSource, /const PAGE_SIZE = 12/);
  assert.match(modalPickerSource, /apiRequest\('\/files'\)/);
  assert.match(modalPickerSource, /startsWith\('image\/'\)/);
  assert.match(modalPickerSource, /paginateClientItems/);
  assert.match(modalPickerSource, /<Pagination/);
  assert.match(modalPickerSource, /<FilePreview/);
});

test('file-backed public logo paths resolve against the configured API origin', () => {
  assert.match(brandSource, /import \{ API_URL \} from '\.\.\/api\.js'/);
  assert.match(brandSource, /return `\$\{API_URL\}\$\{value\}`/);
});

test('default favicon uses the official Yunsoft icon path and custom favicon uses public asset route', () => {
  assert.match(settingsSource, /YUNSOFT_DEFAULT_FAVICON_URL = 'https:\/\/yunsoft\.com\/light-icon\.png'/);
  assert.match(settingsSource, /STUDIO_FAVICON_ASSET_PATH = '\/studio-settings\/favicon'/);
  assert.match(settingsSource, /resolveStudioFavicon/);
});
