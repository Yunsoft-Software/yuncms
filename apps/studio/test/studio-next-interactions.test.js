import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';

import { readStudioRoute, studioPath } from '../src/studio-route.js';

const SRC = resolve(import.meta.dirname, '../src');
const appRailSource = readFileSync(resolve(SRC, 'components/AppRail.jsx'), 'utf8');
const paletteSource = readFileSync(resolve(SRC, 'components/CommandPalette.jsx'), 'utf8');
const graphSource = readFileSync(resolve(SRC, 'components/SchemaGraph.jsx'), 'utf8');
const graphCss = readFileSync(resolve(SRC, 'schema-graph.css'), 'utf8');
const dataModelSource = readFileSync(resolve(SRC, 'screens/DataModelV2Screen.jsx'), 'utf8');
const fieldBuilderSource = readFileSync(resolve(SRC, 'components/FieldBuilder.jsx'), 'utf8');
const fieldIconSource = readFileSync(resolve(SRC, 'components/FieldTypeIcon.jsx'), 'utf8');

test('schema graph has a reserved route that does not consume normal collection names', () => {
  assert.equal(studioPath.schemaGraph(), '#/data-model/~graph');
  assert.deepEqual(readStudioRoute('#/data-model/~graph'), {
    section: 'data-model',
    view: 'graph',
    collection: '',
    field: '',
  });
  assert.equal(readStudioRoute('#/data-model/graph/overview').collection, 'graph');
});

test('Data Model wires a read-only graph from existing collection and relation APIs', () => {
  assert.match(dataModelSource, /SchemaGraph,[\s\S]*from '\.\.\/components\/index\.js';/);
  assert.doesNotMatch(dataModelSource, /components\/SchemaGraph\.jsx/);
  assert.match(dataModelSource, /showGraph = view === 'graph'/);
  assert.match(dataModelSource, /apiRequest\('\/schema\/relations'\)/);
  assert.match(dataModelSource, /<SchemaGraph/);
  assert.match(graphSource, /function buildGraphModel/);
  assert.doesNotMatch(graphSource, /method:\s*['"](?:POST|PATCH|DELETE)['"]/);
  assert.match(graphCss, /\.schema-graph-node\.active/);
  assert.match(graphCss, /\.schema-graph-edge\.dimmed/);
});

test('field type visuals come from one shared SVG component', () => {
  assert.match(fieldIconSource, /export function FieldTypeIcon/);
  assert.match(fieldBuilderSource, /<FieldTypeIcon type=\{option\.value\}/);
  assert.match(dataModelSource, /<FieldTypeIcon type=\{displayType\}/);
  assert.doesNotMatch(dataModelSource, /String\(displayType \|\| '\?'\)\.slice\(0, 1\)/);
});

test('command palette is a shared component with keyboard focus handling', () => {
  assert.match(appRailSource, /import \{ CommandPalette \} from '\.\/CommandPalette\.jsx';/);
  assert.doesNotMatch(appRailSource, /function CommandPalette\(/);
  assert.match(paletteSource, /event\.key === 'Escape'/);
  assert.match(paletteSource, /event\.key === 'ArrowDown'/);
  assert.match(paletteSource, /event\.key === 'ArrowUp'/);
  assert.match(paletteSource, /event\.key === 'Tab'/);
  assert.match(appRailSource, /event\.key\.toLowerCase\(\) === 'k'/);
  assert.match(appRailSource, /event\.key === '\/'/);
});

test('command palette loads visible project collections and keeps failures non-blocking', () => {
  assert.match(appRailSource, /function collectionCommands\(/);
  assert.match(appRailSource, /!collection\.system && !collection\.hidden/);
  assert.match(appRailSource, /apiRequest\('\/schema\/collections'\)/);
  assert.match(appRailSource, /\.catch\(\(\) => \{ if \(!cancelled\) setCollections\(\[\]\); \}\)/);
  assert.match(appRailSource, /displaySchemaName\(collection, 'collection'\)/);
  assert.match(appRailSource, /studioPath\.content\(collection\.collection\)/);
});
