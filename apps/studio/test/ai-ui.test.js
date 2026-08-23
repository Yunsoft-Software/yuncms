import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const appSource = await readFile(new URL('../src/App.jsx', import.meta.url), 'utf8');
const apiSource = await readFile(new URL('../src/api.js', import.meta.url), 'utf8');
const screenSource = await readFile(new URL('../src/screens/AiScreen.jsx', import.meta.url), 'utf8');
const routeSource = await readFile(new URL('../src/studio-route.js', import.meta.url), 'utf8');
const mainSource = await readFile(new URL('../src/main.jsx', import.meta.url), 'utf8');
const cssSource = await readFile(new URL('../src/ai.css', import.meta.url), 'utf8');
const trSource = await readFile(new URL('../src/locales/ai-tr.js', import.meta.url), 'utf8');

test('Studio exposes Yapay Zeka as a first-class top-level section', () => {
  assert.match(routeSource, /'ai'/);
  assert.match(routeSource, /ai:\s*\(\)\s*=>\s*'#\/ai'/);
  assert.match(appSource, /import \{ AiScreen \}/);
  assert.match(appSource, /section === 'ai'/);
  assert.match(appSource, /<AiScreen \/>/);
  assert.match(appSource, /t\('nav\.ai'\)/);
  assert.match(trSource, /'nav\.ai': 'Yapay Zeka'/);
});

test('Studio AI client talks to the built-in AI routes and preserves the per-request write toggle', () => {
  assert.match(apiSource, /export async function aiStatus/);
  assert.match(apiSource, /'\/ai\/status'/);
  assert.match(apiSource, /export async function aiChat/);
  assert.match(apiSource, /'\/ai\/chat'/);
  assert.match(apiSource, /allow_writes: allowWrites/);
  assert.match(screenSource, /useState\(false\)/);
  assert.match(screenSource, /status\?\.writes_available/);
  assert.match(screenSource, /aiChat\(nextHistory, \{ locale, allowWrites \}\)/);
  assert.match(screenSource, /trimConversationHistory/);
});

test('Yapay Zeka UI never exposes MCP terminology to Studio users', () => {
  for (const source of [appSource, screenSource, trSource]) {
    assert.doesNotMatch(source, /\bMCP\b/i);
    assert.doesNotMatch(source, /\/mcp/);
  }
});

test('Yapay Zeka styling uses Studio theme variables and is loaded by the app', () => {
  assert.match(mainSource, /import '\.\/ai\.css'/);
  assert.match(cssSource, /var\(--studio-surface\)/);
  assert.match(cssSource, /var\(--studio-border\)/);
  assert.match(cssSource, /:root\[data-theme="dark"\]/);
  assert.match(cssSource, /@media \(max-width: 600px\)/);
});
