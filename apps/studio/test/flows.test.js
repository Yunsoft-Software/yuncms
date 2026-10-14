import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { addFlowOperation, connectFlowOperation, disconnectFlowOperation, exportFlowDefinition, FLOW_OPERATION_DEFAULTS, flowGraphEdges, importFlowDefinition, newFlowDraft, removeFlowOperation, triggerDefaults } from '../src/flow-graph.js';
import { hasTranslation, SUPPORTED_LOCALES, translate } from '../src/localization.js';
import { readStudioRoute, studioPath } from '../src/studio-route.js';
import { FLOW_OPERATION_TYPES } from '../../../packages/core/src/flows/definition.js';
const source = path => readFileSync(new URL(path, import.meta.url), 'utf8');

test('graph editing preserves success/failure ports, converging branches and node coordinates', () => {
  let flow = newFlowDraft();
  for (const [id, type] of [['check', 'condition'], ['yes', 'transform'], ['no', 'transform'], ['finish', 'log']]) flow = addFlowOperation(flow, type, id);
  const connections = [
    { source: 'trigger', target: 'check' }, { source: 'check', target: 'yes', sourceHandle: 'resolve' },
    { source: 'check', target: 'no', sourceHandle: 'reject' }, { source: 'yes', target: 'finish' }, { source: 'no', target: 'finish' },
  ];
  for (const connection of connections) flow = connectFlowOperation(flow, connection);
  assert.equal(flowGraphEdges(flow).length, 5);
  assert.equal(flow.operations[0].reject, 'no'); assert.deepEqual(flow.operations[0].position, { x: 380, y: 80 });
  assert.throws(() => connectFlowOperation(flow, { source: 'finish', target: 'check' }), /Circular/);
  flow = disconnectFlowOperation(flow, 'check', 'reject'); assert.equal(flow.operations[0].reject, null);
});

test('deleting an operation removes its incoming connections and prevents stale entry references', () => {
  let flow = addFlowOperation(addFlowOperation(newFlowDraft(), 'log', 'first'), 'log', 'second');
  flow = connectFlowOperation(flow, { source: 'trigger', target: 'first' }); flow = connectFlowOperation(flow, { source: 'first', target: 'second' });
  flow = removeFlowOperation(flow, 'first'); assert.equal(flow.entry, null); assert.equal(flow.operations.length, 1); assert.equal(flowGraphEdges(flow).length, 0);
});

test('import/export preserves the diagram, omits server metadata and imports inactive', () => {
  const flow = { ...addFlowOperation(newFlowDraft(), 'log', 'first'), name: 'Example', status: 'active', id: 'server', revision: 7 };
  const encoded = exportFlowDefinition(flow); assert.equal(encoded.id, undefined); assert.equal(encoded.revision, undefined);
  const imported = importFlowDefinition(JSON.parse(JSON.stringify(encoded))); assert.equal(imported.status, 'inactive'); assert.deepEqual(imported.operations, flow.operations);
  assert.throws(() => importFlowDefinition({ ...encoded, options: null }));
  assert.throws(() => importFlowDefinition({ ...encoded, operations: [{ ...encoded.operations[0], name: {} }] }));
});

test('palette, trigger defaults and deep links match the backend graph contract', () => {
  assert.deepEqual(Object.keys(FLOW_OPERATION_DEFAULTS).sort(), [...FLOW_OPERATION_TYPES].sort());
  assert.equal(triggerDefaults('webhook').public, false); assert.equal(triggerDefaults('event').mode, 'action'); assert.equal(triggerDefaults('manual').require_confirmation, true);
  assert.deepEqual(readStudioRoute('#/flows/example'), { section: 'flows', view: 'detail', flowId: 'example' });
  assert.equal(studioPath.newFlow(), '#/flows/new'); assert.equal(studioPath.flow('example'), '#/flows/example');
});

test('Flow screens use shared components and centralized design without page-local visual styling', () => {
  const page = source('../src/screens/FlowsScreen.jsx'), canvas = source('../src/components/FlowCanvas.jsx'), inspector = source('../src/components/FlowInspector.jsx');
  const css = source('../src/studio.css');
  assert.match(css, /@import '@xyflow\/react\/dist\/style\.css'/); assert.match(css, /@import '\.\/flows\.css'/);
  for (const text of [page, canvas, inspector]) { assert.doesNotMatch(text, /<style\b|\bstyle=\{|import ['"].*\.css['"]|\b(?:window\.)?(?:alert|prompt|confirm)\s*\(/); }
  assert.match(page, /<FlowCanvas/); assert.match(page, /<FlowInspector/); assert.match(page, /<Modal/);
  assert.match(canvas, /<Handle type="source"[^\n]*id="resolve"/); assert.match(canvas, /<Handle type="source"[^\n]*id="reject"/);
  assert.match(canvas, /flowGraphEdges\(flow\)/); assert.match(canvas, /onConnect/); assert.match(canvas, /onEdgeDoubleClick/);
  const app = source('../src/App.jsx'); assert.match(app, /id: 'flows'.*adminOnly: true/); assert.match(app, /section === 'flows'\) return session\?\.user\?\.admin/);
  assert.match(source('../src/screens/ContentScreen.jsx'), /<ManualFlowActions collection=\{collection\} keys=\{Array\.from\(selectedRecordIds\)\}/);
});

test('Flow labels exist in every enabled locale and Turkish copy is localized', () => {
  for (const locale of SUPPORTED_LOCALES) for (const key of ['flow.title', 'flow.trigger.manual', 'flow.accountability.trigger', 'flow.run', 'flow.options', 'flow.resolve', 'flow.reject']) assert.equal(hasTranslation(locale, key), true, `${locale}:${key}`);
  assert.equal(translate('tr', 'flow.title'), 'Akışlar'); assert.equal(translate('en', 'flow.title'), 'Flows');
});

test('Flow guide and tracked screenshots preserve their own capture provenance', () => {
  const manifest = JSON.parse(source('../../../docs/assets/screenshots/manifest.json'));
  const guide = source('../../../docs/flows.md');
  assert.match(guide, /assets\/screenshots\/studio-flows\.png/);
  assert.equal(manifest.capturedAt, '2026-09-30');
  assert.equal(manifest.flowCaptures.capturedAt, '2026-10-15');
  for (const file of manifest.flowCaptures.files) {
    assert.ok(manifest.files.includes(file));
    const bytes = readFileSync(new URL(`../../../docs/assets/screenshots/${file}`, import.meta.url));
    assert.deepEqual([...bytes.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
    const capture = manifest.flowCaptures.captures[file];
    assert.equal(createHash('sha256').update(bytes).digest('hex'), capture.sha256, file);
    assert.equal(bytes.readUInt32BE(16), capture.width); assert.equal(bytes.readUInt32BE(20), capture.height);
  }
});

test('illustrated Flow guides link to existing images, importable examples and valid local section anchors', () => {
  const base = new URL('../../../docs/', import.meta.url);
  const slug = text => text.toLowerCase().replace(/[`*]/g, '').replace(/[^\p{L}\p{N}_\- ]/gu, '').trim().replace(/ /g, '-');
  const manifest = JSON.parse(source('../../../docs/assets/screenshots/manifest.json'));
  const images = new Set();
  for (const path of ['flows.md', 'flows-recipes.md']) {
    const text = readFileSync(new URL(path, base), 'utf8');
    const links = [...text.matchAll(/!?\[[^\]]+\]\(([^)]+)\)/g)].map(match => match[1]);
    links.push(...[...text.matchAll(/<img\s+src="([^"]+)"/g)].map(match => match[1]));
    for (const link of links) {
      if (/^https?:/.test(link)) continue;
      const [file, anchor] = link.split('#'), target = new URL(file || path, base);
      const bytes = readFileSync(target);
      if (target.pathname.endsWith('.md') && anchor) {
        const headings = [...bytes.toString('utf8').matchAll(/^#{1,6}\s+(.+)$/gm)].map(match => slug(match[1]));
        assert.ok(headings.includes(anchor), `Missing section: ${path} -> ${link}`);
      }
      if (target.pathname.endsWith('.png')) images.add(target.pathname.split('/').at(-1));
    }
  }
  for (const filename of manifest.flowCaptures.files) assert.ok(images.has(filename), `Unillustrated capture: ${filename}`);
});
