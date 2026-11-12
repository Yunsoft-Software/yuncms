import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { contentColumnKind, flexibleContentColumnKey, relationPreview } from '../src/content-presentation.js';

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

test('field-builder labels use theme-aware accent ink rather than the action fill', () => {
  const builder = read('field-builder.css');
  for (const selector of ['.field-config-type', '.accountability-builder-heading > span small', '.accountability-option code', '.system-resource-pill']) {
    const rule = builder.slice(builder.indexOf(selector)).split('}')[0];
    assert.match(rule, /color: var\(--ui-accent-ink, var\(--studio-accent\)\)/, selector);
  }
});

test('account status colors follow semantic theme tokens without legacy light-only ink', () => {
  for (const [status, token] of [['active', '--ui-success'], ['suspended', '--ui-warning'], ['disabled', '--ui-text-secondary']]) {
    const rule = theme.slice(theme.indexOf(`.studio-next-app .user-status-pill.${status}`)).split('}')[0];
    assert.match(rule, new RegExp(`color: var\\(${token}\\)`), status);
  }
  assert.doesNotMatch(read('usability-pass.css'), /\.user-status-pill\.(active|suspended|disabled)\s*[,\{]/);
});

test('single-relation choices bound long labels and preserve their complete accessible tooltip', () => {
  assert.match(read('content-inspector-next.css'), /\.relation-picker-trigger > span:first-child,[\s\S]*?-webkit-line-clamp: 2/);
  assert.match(read('components/RelationPicker.jsx'), /title=\{selectedLabel \? String\(selectedLabel\) : undefined\}/);
  assert.match(read('components/RelationPicker.jsx'), /<span title=\{String\(itemLabel\)\}/);
});

test('typed columns isolate identifiers, relation summaries and normal scalar data', () => {
  for (const [field, kind] of [[{ field: 'id' }, 'identity'], [{ type: 'uuid' }, 'identity'], [{ virtualRelation: {} }, 'relation'], [{ type: 'boolean' }, 'scalar'], [{ type: 'datetime' }, 'date'], [{ interface: 'image' }, 'file'], [{ field: 'status' }, 'status'], [{ type: 'text' }, 'text']]) assert.equal(contentColumnKind(field), kind);
  assert.equal(contentColumnKind({ type: 'uuid', interface: 'image' }), 'file');
  assert.equal(contentColumnKind({ type: 'uuid' }, { targetCollection: 'authors' }), 'reference');
  assert.match(read('screens/ContentScreen.jsx'), /contentColumnKind\(field, relationLookups\[field.field\]\)/);
});

test('fixed-width-only tables give their first data column remaining space', () => {
  assert.equal(flexibleContentColumnKey([]), null);
  assert.equal(flexibleContentColumnKey([{ field: 'enabled', type: 'boolean' }]), 'enabled');
  assert.equal(flexibleContentColumnKey([{ field: 'blog_id', type: 'uuid' }, { field: 'category_id', type: 'uuid' }], { blog_id: {}, category_id: {} }), 'blog_id');
  assert.equal(flexibleContentColumnKey([{ field: 'id' }, { field: 'name', type: 'string' }]), null);
  assert.equal(flexibleContentColumnKey([{ field: 'translations', virtualRelation: { kind: 'translations' } }]), null);
});

test('mobile record cards constrain long relation names and omit internal label aliases', () => {
  assert.match(theme, /:is\(\.mobile-record-card, \.mobile-user-card\)[^}]*grid-template-columns: minmax\(0, 1fr\)/s);
  assert.match(theme, /\.mobile-record-card > header \.table-cell-text[^}]*white-space: normal/s);
  assert.doesNotMatch(read('screens/ContentScreen.jsx'), /t\('content\.relationHint'/);
});

test('compact permission and file actions remain inside their cells', () => {
  assert.match(theme, /\.permission-action-controls[^}]*grid-template-columns: minmax\(0, 1fr\)/s);
  assert.match(theme, /\.file-card-actions[^}]*grid-template-columns: repeat\(2, minmax\(0, 1fr\)\)/s);
  assert.match(theme, /\.file-detail-actions[^}]*grid-template-columns: repeat\(3, minmax\(0, 1fr\)\)/s);
  assert.match(read('screens/RolesPermissionsScreen.jsx'), /showCreateRole \? 'text-button' : 'primary-button'/);
  assert.match(theme, /\.permission-master-switch[^}]*display: grid; grid-template-columns: minmax\(0, 1fr\) auto/s);
  assert.match(theme, /@container \(max-width: 380px\)[^]*\.field-choice-grid[^}]*grid-template-columns: minmax\(0, 1fr\)/);
});

test('tablet user filters form a complete row beneath the full-width search', () => {
  assert.match(theme, /\.user-list-controls[^}]*grid-template-columns: repeat\(3, minmax\(0, 1fr\)\)/s);
  assert.match(theme, /\.user-list-controls \.field-label:first-child[^}]*grid-column: 1 \/ -1/s);
  assert.match(theme, /\.users-header-panel \.workspace-toolbar-heading[^}]*grid-template-columns: minmax\(0, 1fr\) auto/s);
});

test('file lists keep every action visible in tablet rows and labeled mobile cards', () => {
  assert.match(read('screens/FilesScreen.jsx'), /className="table-scroll file-table-container"/);
  assert.match(read('screens/FilesScreen.jsx'), /data-label=\{t\('files.uploaded'\)\}/);
  assert.match(theme, /\.file-table-container[^}]*container-type: inline-size/s);
  assert.match(theme, /@container \(max-width: 900px\)[^]*:nth-child\(2\), :nth-child\(4\)\)[^}]*display: none/);
  assert.match(theme, /@container \(max-width: 540px\)[^]*\.file-table td\[data-label\]::before[^}]*content: attr\(data-label\)/);
  assert.match(theme, /\.file-table td\.row-actions[^}]*grid-column: 1 \/ -1[^}]*min-width: 0/s);
});

test('narrow desktop workspaces keep branding and content controls within available width', () => {
  assert.match(theme, /\.sidebar-brand-row \.studio-brand-logo[^}]*width: 100%[^}]*object-fit: contain/s);
  assert.match(theme, /\.content-data-controls-main[^}]*grid-template-columns: minmax\(0, 1.5fr\) minmax\(0, .8fr\) minmax\(0, .6fr\)/s);
  assert.match(theme, /@media \(max-width: 1400px\)[^]*\.appearance-layout[^}]*grid-template-columns: minmax\(0, 1fr\)/);
  assert.match(theme, /table\.content-table-short[^}]*min-width: 100%/s);
  assert.match(theme, /\.content-table-short \.content-column-relation[^}]*width: 40%/s);
  assert.match(theme, /\.ai-settings-toggle[^}]*align-self: stretch; align-items: center/s);
  assert.match(read('screens/ContentScreen.jsx'), /visibleTableFields.length <= 2 \? 'content-table-short'/);
});

test('table clipping preserves complete text and keeps actions in the table grid', () => {
  assert.match(read('components/TableCellText.jsx'), /title=\{String\(children \?\? ''\)\}/);
  assert.match(theme, /\.table-cell-text[^}]*text-overflow: ellipsis/s);
  assert.match(theme, /-webkit-line-clamp: 2/);
  assert.match(theme, /td\.row-actions[^}]*display: table-cell/);
  assert.doesNotMatch(theme, /\.table-panel (?:th|td):last-child/);
  assert.match(relations, /\.nested-translation-title[^}]*white-space: nowrap/s);
  assert.match(relations, /\.nested-cell-translations[^}]*align-items: center/s);
  assert.match(read('components/TableRowActions.jsx'), /aria-label=\{label\} title=\{label\}/);
  assert.match(read('screens/FilesScreen.jsx'), /TableRowActions actions=/);
  assert.match(read('screens/UsersScreen.jsx'), /TableRowActions actions=/);
});

test('shared typography, portals, grid panels and mobile cards use the same presentation rules', () => {
  assert.match(read('studio.css'), /@import '@fontsource-variable\/inter'/);
  assert.match(theme, /--font-weight-regular: 400/);
  assert.match(theme, /--font-weight-heading: 600/);
  assert.match(theme, /\.data-model-detail-panel[^}]*grid-template-columns: minmax\(0, 1fr\)/s);
  assert.match(theme, /\.panel\.permission-detail-page/);
  assert.match(theme, /:is\(\.studio-next-app, \.studio-inspector\) \.field-label:has/);
  assert.match(theme, /\.studio-app-rail-button > span[^}]*display: block/s);
  assert.match(read('contexts/StudioSettingsContext.jsx'), /loading \? <div className="studio-boot" aria-busy="true"/);
  assert.match(read('contexts/StudioSettingsContext.jsx'), /apiRequest\('\/studio-settings'\)/);
});

test('navigation labels remain visible and layouts adapt to narrow viewports', () => {
  assert.match(theme, /\.studio-app-rail-button > span[^}]*position: static/s);
  assert.match(theme, /@media \(max-width: 1100px\)/);
  assert.match(theme, /@media \(max-width: 420px\)/);
  assert.doesNotMatch(read('screens/DataModelV2Screen.jsx'), /<main\b/);
  assert.match(read('screens/DataModelV2Screen.jsx'), /<section className="data-model-workspace">/);
  assert.match(theme, /\.auth-card[^}]*width: min\(calc\(100% - 32px\), 520px\)/s);
});

test('tablet navigation and short tables cover intermediate pane widths', () => {
  assert.doesNotMatch(read('styles.css'), /^\s*nav\s*\{/m);
  assert.equal((read('App.jsx').match(/matchMedia\('\(max-width: 1100px\)'\)/g) ?? []).length, 2);
  for (const file of ['navigation-v2.css', 'mobile-responsive.css', 'studio-next.css', 'studio-compat.css', 'files-next.css', 'file-category-rail.css', 'data-view-options.css', 'content-workbench-next.css', 'users-mcp-next.css', 'access-next.css', 'appearance.css']) {
    assert.match(read(file), /@media \(max-width: 1100px\)/);
    assert.doesNotMatch(read(file), /@media \(max-width: 900px\)/);
  }
  assert.match(theme, /@container \(min-width: 700px\)[^]*\.content-table-panel-short \.table-scroll[^}]*display: block/);
  assert.match(read('screens/ContentScreen.jsx'), /visibleTableFields.length <= 2 \? 'content-table-panel-short'/);
  assert.match(theme, /\.mobile-card-actions[^}]*repeat\(auto-fit, minmax\(80px, 1fr\)\)/);
  assert.match(theme, /grid-template-areas: "search search search" "sort direction filter-toggle"/);
  assert.match(theme, /\.content-view-control-group[^}]*grid-area: filter-toggle/);
  assert.match(theme, /\.mobile-user-card dl[^}]*grid-template-columns: repeat\(3, minmax\(0, 1fr\)\)/);
  assert.match(theme, /\.library-header-panel \.workspace-toolbar-actions > button[^}]*width: auto/);
  assert.doesNotMatch(read('content-workbench-next.css'), /\.mobile-filter-toggle\s*\{[^}]*grid-area/);
  assert.doesNotMatch(read('content-density.css'), /\.mobile-filter-toggle\s*\{[^}]*grid-column/);
});


test('content forms align boolean controls, nested label actions and full-width rich text', () => {
  const screen = readFileSync(new URL('../src/screens/ContentScreen.jsx', import.meta.url), 'utf8');
  const nested = readFileSync(new URL('../src/components/NestedRelationsEditor.jsx', import.meta.url), 'utf8');
  assert.match(screen, /richtext-field-label/); assert.doesNotMatch(screen, /rich-text-field-label/);
  assert.match(screen, /<BooleanFieldControl/); assert.match(nested, /<BooleanFieldControl/);
  assert.match(relations, /\.richtext-toolbar-group[^}]*flex-wrap: wrap[^}]*max-width: 100%/s);
  assert.match(relations, /\.richtext-mode-switch[^}]*grid-template-columns: repeat\(3, minmax\(0, 1fr\)\)[^}]*max-width: 100%/s);
  assert.match(relations, /\.nested-m2m-option.active[^}]*color: var\(--ui-accent-ink, var\(--ui-accent\)\)/s);
  assert.match(relations, /@container \(max-width: 320px\)[^]*\.richtext-mode-switch[^}]*grid-template-columns: minmax\(0, 1fr\)/);
  assert.match(read('asset-picker.css'), /@container \(max-width: 320px\)[^]*\.brand-asset-actions[^}]*grid-column: 1 \/ -1/);
  assert.match(relations, /\.nested-language-tabs[^}]*flex-wrap: nowrap[^}]*overflow-x: auto/s);
  assert.match(relations, /\.nested-language-tab[^}]*flex: 0 0 auto/s);
  assert.match(relations, /\.nested-m2m-grid[^}]*max-height: min\(480px, 65vh\)[^}]*overflow: auto/s);
  assert.match(relations, /\.nested-m2m-grid[^}]*grid-auto-rows: max-content/s);
  assert.match(relations, /\.nested-m2m-label[^}]*-webkit-line-clamp: 2[^}]*overflow: hidden/s);
  assert.match(nested, /className="nested-m2m-label" title=\{String\(itemLabel\)\}/);
  assert.match(nested, /dir=\{lang.direction === 'rtl' \? 'rtl' : undefined\}/);
  assert.match(nested, /new ResizeObserver\(revealSelected\)/);
  assert.match(nested, /tabs.scrollBy\(\{ left, behavior: 'instant' \}\)/);
  assert.match(theme, /\.record-editor[^}]*min-width: 0[^}]*grid-template-columns: minmax\(0, 1fr\)/s);
  assert.match(screen, /aria-busy=\{nestedLoading\}/);
  assert.match(screen, /if \(!canSave \|\| nestedLoading \|\| nestedFailed\) return/);
});


test('late collection labels and schema refreshes cannot clear an already loaded record', () => {
  const source = readFileSync(new URL('../src/screens/ContentScreen.jsx', import.meta.url), 'utf8');
  const schemaEffect = source.slice(source.indexOf('    setInspectedRecord(null);', source.indexOf('setSearch(searchInput.trim())')), source.indexOf('  }, [collection, locale]'));
  assert.ok(schemaEffect.includes('loadCollectionSchema(collection)'));
  assert.doesNotMatch(schemaEffect, /setEditingRecord/);
  assert.doesNotMatch(schemaEffect, /collectionLabelVersion/);
  assert.match(source, /setLoadedRecordKey\(''\)/);
});
