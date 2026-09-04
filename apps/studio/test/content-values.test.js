import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';

const SRC = resolve(import.meta.dirname, '../src');
const contentSource = readFileSync(resolve(SRC, 'screens/ContentScreen.jsx'), 'utf8');
const valueCss = readFileSync(resolve(SRC, 'content-values.css'), 'utf8');

test('Content renders booleans, dates and statuses as typed values', () => {
  assert.match(contentSource, /field\.type === 'boolean'/);
  assert.match(contentSource, /content-value-boolean/);
  assert.match(contentSource, /Intl\.DateTimeFormat/);
  assert.match(contentSource, /content-value-date/);
  assert.match(contentSource, /field\.field === 'status'/);
  assert.match(contentSource, /content-value-status/);
});

test('Content typed values remain readable without color alone', () => {
  assert.match(contentSource, /t\(value \? 'common\.yes' : 'common\.no'\)/);
  assert.match(contentSource, /<time className="content-value-date"/);
  assert.match(contentSource, /content-value-empty/);
  assert.match(valueCss, /\.content-value-boolean\.is-true/);
  assert.match(valueCss, /\.content-value-status/);
});
