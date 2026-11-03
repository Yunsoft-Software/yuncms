import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { contentColumnKind, relationPreview } from '../src/content-presentation.js';

const read = name => readFileSync(new URL(`../src/${name}`, import.meta.url), 'utf8');
const theme = read('studio-theme.css'), relations = read('content-relations.css');

test('Studio loads one shared theme and removes the superseded animated theme', () => {
  const css = read('studio.css');
  assert.ok(css.indexOf("@import './studio-theme.css';") > css.indexOf("@import './users-mcp-next.css';"));
  assert.doesNotMatch(css, /studio-kinetic/);
  assert.doesNotMatch(theme, /yun-gradient-drift|yun-orbit-drift|linear-gradient/);
});

test('light and dark surfaces and actions follow shared tokens and the configured accent', () => {
  for (const token of ['--yun-canvas:', '--yun-surface:', '--yun-ink:', '--yun-line:']) {
    assert.ok(theme.slice(theme.indexOf(":root[data-theme='dark']")).includes(token));
  }
  assert.match(theme, /--yun-action-bg: var\(--studio-accent\)/);
  assert.match(theme, /accent-color: var\(--ui-accent\)/);
  assert.match(theme, /@media \(prefers-reduced-motion: reduce\)/);
});

test('relation summaries remain bounded for arbitrary cardinality without altering source rows', () => {
  const rows = Array.from({ length: 2000 }, (_, id) => ({ id }));
  const preview = relationPreview(rows);
  assert.deepEqual(preview.visible, rows.slice(0, 2));
  assert.equal(preview.remaining, 1998);
  assert.equal(rows.length, 2000);
  assert.deepEqual(relationPreview([]), { visible: [], remaining: 0 });
  const source = read('components/NestedRelationsEditor.jsx');
  assert.equal((source.match(/preview\.visible\.map/g) ?? []).length, 2);
  assert.match(source, /preview\.remaining/);
});

test('typed columns isolate identifiers, relation summaries and normal scalar data', () => {
  for (const [field, kind] of [[{ field: 'id' }, 'identity'], [{ type: 'uuid' }, 'identity'], [{ virtualRelation: {} }, 'relation'], [{ type: 'boolean' }, 'scalar'], [{ type: 'datetime' }, 'date'], [{ interface: 'image' }, 'file'], [{ field: 'status' }, 'status'], [{ type: 'text' }, 'text']]) assert.equal(contentColumnKind(field), kind);
  assert.match(read('screens/ContentScreen.jsx'), /className=\{`content-column-\$\{contentColumnKind\(field\)\}`\}/);
});

test('table clipping preserves complete text and limits sticky treatment to action columns', () => {
  assert.match(read('components/TableCellText.jsx'), /title=\{String\(children \?\? ''\)\}/);
  assert.match(theme, /\.table-cell-text[^}]*text-overflow: ellipsis/s);
  assert.match(theme, /-webkit-line-clamp: 2/);
  assert.match(theme, /td\.row-actions[^}]*display: table-cell/);
  assert.doesNotMatch(theme, /\.table-panel (?:th|td):last-child/);
  assert.match(relations, /\.nested-translation-title[^}]*white-space: nowrap/s);
  assert.match(relations, /minmax\(min\(100%, 360px\), 1fr\)/);
});

test('navigation labels remain visible and layouts adapt to narrow viewports', () => {
  assert.match(theme, /\.studio-app-rail-button > span[^}]*position: static/s);
  assert.match(theme, /@media \(max-width: 900px\)/);
  assert.match(theme, /@media \(max-width: 420px\)/);
  assert.doesNotMatch(read('screens/DataModelV2Screen.jsx'), /<main\b/);
  assert.match(read('screens/DataModelV2Screen.jsx'), /<section className="data-model-workspace">/);
});
