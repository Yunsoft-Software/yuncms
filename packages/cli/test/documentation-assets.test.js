import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, lstatSync, readdirSync, readFileSync } from 'node:fs';
import { relative, resolve } from 'node:path';
import test from 'node:test';

const root = resolve(import.meta.dirname, '../../..');

test('public listing metadata includes the website and Glama maintainer', () => {
  const readme = readFileSync(resolve(root, 'README.md'), 'utf8');
  const glama = JSON.parse(readFileSync(resolve(root, 'glama.json'), 'utf8'));

  assert.match(readme, /^Website: \[https:\/\/yunsoft\.com\]\(https:\/\/yunsoft\.com\)$/m);
  assert.equal(glama.$schema, 'https://glama.ai/mcp/schemas/server.json');
  assert.deepEqual(glama.maintainers, ['raichubuilds']);
});

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
  assert.match(readme, /\[screenshot manifest\]\(docs\/assets\/screenshots\/manifest\.json\)/);
  assert.doesNotMatch(readme, /screenshots were captured from the current published package/);
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

function checkWebsiteBundle(version) {
  const bundleRoot = resolve(root, `docs/yuncms-docs-${version}`);
  const manifestPath = resolve(bundleRoot, 'manifest.json');
  assert.equal(existsSync(manifestPath), true, `Missing bundle manifest: ${manifestPath}`);
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));

  // Exact schema contract
  assert.deepEqual(Object.keys(manifest).sort(), [
    'defaultPage', 'locales', 'pages', 'product', 'schemaVersion',
    'screenshots', 'sourceCommit', 'sourceRepo', 'verifiedAt', 'version',
  ]);
  assert.equal(manifest.schemaVersion, 1);
  assert.equal(manifest.product, 'yuncms');
  assert.equal(manifest.version, version);
  assert.match(manifest.version, /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/);
  assert.notEqual(manifest.version, 'latest');
  assert.equal(manifest.sourceRepo, 'Yunsoft-Software/yuncms');
  assert.match(manifest.sourceCommit, /^[0-9a-f]{40}$/);
  assert.match(manifest.verifiedAt, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/);

  // No symlinks anywhere inside the bundle
  const walk = (dir) => {
    for (const entry of readdirSync(dir)) {
      const full = resolve(dir, entry);
      const st = lstatSync(full);
      assert.equal(st.isSymbolicLink(), false, `Symlink forbidden in docs bundle: ${full}`);
      if (st.isDirectory()) walk(full);
    }
  };
  walk(bundleRoot);

  // Locales and identical TR/EN slug sets
  assert.deepEqual(Object.keys(manifest.locales).sort(), ['en', 'tr']);
  const trSlugs = manifest.locales.tr.sections.flatMap(s => s.pages);
  const enSlugs = manifest.locales.en.sections.flatMap(s => s.pages);
  assert.deepEqual(trSlugs, enSlugs);
  assert.ok(trSlugs.includes(manifest.defaultPage));
  assert.deepEqual(manifest.locales.tr.sections.map(s => s.id), manifest.locales.en.sections.map(s => s.id));

  const pageSlugs = manifest.pages.map(p => p.slug);
  assert.deepEqual([...pageSlugs].sort(), [...enSlugs].sort());
  const validSlugs = new Set(pageSlugs);

  // Screenshots manifest verification
  const screenshotsByFile = new Map();
  const screenshotsById = new Map();
  for (const shot of manifest.screenshots) {
    assert.deepEqual(Object.keys(shot).sort(), [
      'alt', 'caption', 'capturedFrom', 'file', 'id', 'locale', 'product', 'sanitized', 'sha256', 'version',
    ]);
    assert.equal(shot.product, 'yuncms');
    assert.equal(shot.version, manifest.version);
    assert.ok(['en', 'tr'].includes(shot.locale));
    assert.equal(shot.sanitized, true);
    assert.match(shot.file, new RegExp(`^assets/${shot.locale}/[a-z0-9-]+\\.(?:png|webp)$`));
    assert.equal(shot.file.includes('..'), false);
    const abs = resolve(bundleRoot, shot.file);
    assert.equal(relative(bundleRoot, abs).startsWith('..'), false);
    const bytes = readFileSync(abs);
    if (shot.file.endsWith('.png')) {
      assert.deepEqual([...bytes.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10], shot.file);
    } else {
      assert.equal(bytes.toString('ascii', 0, 4), 'RIFF', shot.file);
      assert.equal(bytes.toString('ascii', 8, 12), 'WEBP', shot.file);
    }
    assert.equal(createHash('sha256').update(bytes).digest('hex'), shot.sha256, shot.file);
    assert.match(shot.id, /^[a-z0-9]+(?:[-_][a-z0-9]+)*$/);
    assert.ok(!screenshotsById.has(shot.id), `Duplicate screenshot ID: ${shot.id}`);
    screenshotsByFile.set(shot.file, shot);
    screenshotsById.set(shot.id, shot);
  }

  // Check version visibility, internal links, locale-scoped images, and secrets.
  const referencedImages = new Set();
  for (const page of manifest.pages) {
    for (const locale of ['tr', 'en']) {
      const meta = page.locales[locale];
      assert.equal(meta.file, `locales/${locale}/${page.slug}.md`);
      const abs = resolve(bundleRoot, meta.file);
      assert.equal(relative(bundleRoot, abs).startsWith('..'), false);
      const md = readFileSync(abs, 'utf8');
      assert.ok(md.includes(`YunCMS ${manifest.version}`), `${meta.file} must visibly display version`);
      assert.doesNotMatch(md, /BEGIN [A-Z ]*PRIVATE KEY|ghp_[A-Za-z0-9]{20,}|npm_[A-Za-z0-9]{20,}/);
      if (version === '2.1.3') {
        assert.doesNotMatch(md, /YUNCMS_PREMIUM_OFFER_URL|kredi kartsız|no credit card/i,
          `${meta.file} must describe the published 2.1.3 runtime`);
      }

      // Images must stay strictly inside bundle and match locale
      for (const match of md.matchAll(/!\[[^\]]*\]\(([^)]+)\)/g)) {
        const imgHref = match[1];
        const registered = imgHref.startsWith('screenshot:')
          ? screenshotsById.get(imgHref.slice('screenshot:'.length))
          : screenshotsByFile.get(imgHref.replace(/^\.\//, ''));
        assert.ok(registered, `${meta.file} references unregistered image: ${imgHref}`);
        assert.equal(registered.locale, locale, `${meta.file} must reference ${locale} screenshots only`);
        referencedImages.add(registered.file);
      }

      // Internal page links must use doc:<slug> or ./<slug>
      for (const match of md.matchAll(/(?<!!)\[[^\]]+\]\(([^)]+)\)/g)) {
        const href = match[1];
        if (/^https?:\/\//.test(href)) continue;
        const m = href.match(/^(?:doc:|\.\/)([a-z0-9-]+)$/);
        assert.ok(m && validSlugs.has(m[1]), `${meta.file} has invalid internal link: ${href}`);
      }
    }
  }
  for (const file of screenshotsByFile.keys()) {
    assert.ok(referencedImages.has(file), `Unreferenced bundle screenshot: ${file}`);
  }

  const docsIndex = readFileSync(resolve(root, 'docs/README.md'), 'utf8');
  assert.ok(docsIndex.includes(`yuncms-docs-${version}/manifest.json`));
}

test('published bilingual bundles follow the Website importer contract and AGENTS.md rules', () => {
  const docs = resolve(root, 'docs');
  const versions = readdirSync(docs).flatMap(name => {
    const match = name.match(/^yuncms-docs-(\d+\.\d+\.\d+)$/);
    return match ? [match[1]] : [];
  });
  assert.ok(versions.length > 0, 'At least one published version must have a documentation bundle');
  for (const version of versions) checkWebsiteBundle(version);

  const readme = readFileSync(resolve(root, 'README.md'), 'utf8');
  assert.ok(versions.some(version => readme.includes(`docs/yuncms-docs-${version}/manifest.json`)));
  const agents = readFileSync(resolve(root, 'AGENTS.md'), 'utf8');
  assert.match(agents, /Turkish \(TR\) and English \(EN\) documentation.*Studio screenshots.*in parallel.*same version/i);
});
