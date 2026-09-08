import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';

const root = resolve(import.meta.dirname, '../../..');

test('public documentation screenshots track the current release', () => {
  const workspace = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'));
  const manifest = JSON.parse(readFileSync(resolve(root, 'docs/assets/screenshots/manifest.json'), 'utf8'));
  const readme = readFileSync(resolve(root, 'README.md'), 'utf8');

  assert.equal(manifest.yuncmsVersion, workspace.version);
  assert.ok(Array.isArray(manifest.files));
  assert.ok(manifest.files.length >= 4);

  for (const file of manifest.files) {
    assert.match(file, /\.(?:png|jpe?g|webp|gif)$/i);
    assert.equal(existsSync(resolve(root, 'docs/assets/screenshots', file)), true, `Missing documentation screenshot: ${file}`);
  }

  assert.match(readme, /docs\/assets\/screenshots\/studio-content\.png/);
  assert.match(readme, /docs\/assets\/screenshots\/studio-data-model\.png/);
});

test('AI documentation is consistently English and documents every Studio language', () => {
  const guide = readFileSync(resolve(root, 'docs/ai-assistant.md'), 'utf8');
  const documentationIndex = readFileSync(resolve(root, 'docs/README.md'), 'utf8');
  const readme = readFileSync(resolve(root, 'README.md'), 'utf8');
  const studioGuide = readFileSync(resolve(root, 'docs/studio.md'), 'utf8');
  const apiGuide = readFileSync(resolve(root, 'docs/rest-api.md'), 'utf8');

  assert.match(guide, /^# YunCMS AI Assistant$/m);
  assert.doesNotMatch(guide, /Yapay Zeka|Ayarlar|Salt okunur|Otomatik yazma|Tam yetki/);
  for (const locale of ['en', 'tr', 'es', 'de', 'fr', 'pt-BR', 'ja', 'zh-CN']) {
    assert.ok(guide.includes(`(\`${locale}\`)`), locale);
    assert.ok(apiGuide.includes(`\`${locale}\``), locale);
  }
  assert.match(studioGuide, /English, Turkish, Spanish, German, French, Brazilian Portuguese, Japanese and Simplified Chinese/);
  assert.match(guide, /falls back to English/);
  assert.match(readme, /\[Localization\]\(docs\/studio-customization\.md#localization\)/);
  assert.match(documentationIndex, /\[Localization\]\(studio-customization\.md#localization\)/);
});
