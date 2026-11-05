import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { nextNavigationFocusIndex } from '../src/navigation-focus.js';

test('navigation focus visits every control including links in both directions', () => {
  assert.deepEqual([0, 1, 2, 3].map(index => nextNavigationFocusIndex(4, index)), [1, 2, 3, 0]);
  assert.deepEqual([0, 1, 2, 3].map(index => nextNavigationFocusIndex(4, index, true)), [3, 0, 1, 2]);
  assert.equal(nextNavigationFocusIndex(1, 0), 0);
  assert.equal(nextNavigationFocusIndex(1, 0, true), 0);
  assert.equal(nextNavigationFocusIndex(4, -1), 0);
  assert.equal(nextNavigationFocusIndex(4, -1, true), 3);
  assert.equal(nextNavigationFocusIndex(4, 4), 0);
  assert.equal(nextNavigationFocusIndex(0, -1), -1);
});

test('mobile navigation resolves each Tab step instead of trusting native link traversal', async () => {
  const source = await readFile(new URL('../src/App.jsx', import.meta.url), 'utf8');
  const handler = source.slice(source.indexOf('function handleNavigationKey('), source.indexOf('  useEffect(() => {\n    const media'));
  assert.match(handler, /nextNavigationFocusIndex\(controls\.length, controls\.indexOf\(document\.activeElement\), event\.shiftKey\)/);
  assert.match(handler, /event\.preventDefault\(\);\s*controls\[next\]\?\.focus\(\)/);
  assert.match(handler, /if \(!mobileLayout \|\| !mobileNavOpen\) return/);
});

test('navigation dividers follow shared theme colors and empty support areas take no space', async () => {
  const [base, theme] = await Promise.all(['styles.css', 'studio-theme.css'].map(file => readFile(new URL('../src/' + file, import.meta.url), 'utf8')));
  assert.match(base, /\.sidebar-footer\s*\{[^}]*border-top:\s*1px solid var\(--ui-border,/);
  assert.match(theme, /\.sidebar-support-links:empty\s*\{\s*display:\s*none;/);
});
