import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const appSource = await readFile(new URL('../src/App.jsx', import.meta.url), 'utf8');
const apiSource = await readFile(new URL('../src/api.js', import.meta.url), 'utf8');
const screenSource = await readFile(new URL('../src/screens/AiScreen.jsx', import.meta.url), 'utf8');
const settingsSource = await readFile(new URL('../src/components/AiSettingsPanel.jsx', import.meta.url), 'utf8');
const routeSource = await readFile(new URL('../src/studio-route.js', import.meta.url), 'utf8');
const mainSource = await readFile(new URL('../src/main.jsx', import.meta.url), 'utf8');
const studioCss = await readFile(new URL('../src/studio.css', import.meta.url), 'utf8');
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

test('Studio AI client uses built-in chat and administrator settings routes', () => {
  assert.match(apiSource, /export async function aiStatus/);
  assert.match(apiSource, /export async function aiSettings/);
  assert.match(apiSource, /export async function saveAiSettings/);
  assert.match(apiSource, /'\/ai\/settings'/);
  assert.match(apiSource, /export async function aiChat/);
  assert.match(apiSource, /allow_writes: allowWrites/);
  assert.match(apiSource, /allow_deletes: allowWrites && allowDeletes/);
  assert.match(screenSource, /<AiSettingsPanel/);
  assert.match(screenSource, /requestError\?\.status === 403/);
  assert.match(screenSource, /status\?\.writes_available/);
  assert.match(screenSource, /aiChat\(nextHistory, \{ locale, \.\.\.aiAccessFlags\(accessMode\) \}\)/);
  assert.match(screenSource, /AI_ACCESS_MODES\.READ/);
  assert.match(screenSource, /AI_ACCESS_MODES\.WRITE/);
  assert.match(screenSource, /AI_ACCESS_MODES\.FULL/);
  assert.match(screenSource, /\{ready && \(\s*<div className="ai-chat-shell">/);
});

test('AI settings form never pre-fills or renders the saved API key', () => {
  assert.match(settingsSource, /type="password"/);
  assert.match(settingsSource, /settings\?\.has_api_key/);
  assert.match(settingsSource, /patch\.api_key = form\.apiKey\.trim\(\)/);
  assert.doesNotMatch(settingsSource, /settings\?\.api_key/);
  assert.doesNotMatch(settingsSource, /value=\{settings[^}]*api_key/);
});

test('Yapay Zeka UI never exposes MCP terminology to Studio users', () => {
  for (const source of [screenSource, settingsSource, trSource]) {
    assert.doesNotMatch(source, /\bMCP\b/i);
    assert.doesNotMatch(source, /\/mcp/);
  }
});

test('Yapay Zeka styling uses Studio theme variables and is loaded by the app', () => {
  assert.match(mainSource, /import '\.\/studio\.css'/);
  assert.match(studioCss, /@import '\.\/ai\.css';/);
  assert.match(cssSource, /var\(--studio-surface\)/);
  assert.match(cssSource, /\.ai-settings-panel/);
  assert.match(cssSource, /:root\[data-theme="dark"\]/);
  assert.match(cssSource, /@media \(max-width: 600px\)/);
});
