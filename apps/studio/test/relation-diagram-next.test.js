import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';

const SRC = resolve(import.meta.dirname, '../src');
const dataModelSource = readFileSync(resolve(SRC, 'screens/DataModelV2Screen.jsx'), 'utf8');
const diagramSource = readFileSync(resolve(SRC, 'components/RelationDiagram.jsx'), 'utf8');
const diagramCss = readFileSync(resolve(SRC, 'relation-diagram.css'), 'utf8');

test('Data Model previews direct relations without changing the create payload', () => {
  assert.match(dataModelSource, /<RelationDiagram[\s\S]*kind=\{relationMode\}/);
  assert.match(dataModelSource, /leftCollection=\{selected\}/);
  assert.match(dataModelSource, /leftField=\{directForm\.manyField\}/);
  assert.match(dataModelSource, /rightCollection=\{directForm\.oneCollection\}/);
  assert.match(dataModelSource, /onDelete=\{directForm\.onDelete\}/);
  assert.match(dataModelSource, /manyCollection: selected/);
  assert.match(dataModelSource, /manyField: directForm\.manyField/);
  assert.match(dataModelSource, /oneCollection: directForm\.oneCollection/);
});

test('Data Model previews many-to-many junctions from the current form state', () => {
  assert.match(dataModelSource, /kind="m2m"/);
  assert.match(dataModelSource, /junctionCollection=\{m2mForm\.junctionCollection\}/);
  assert.match(dataModelSource, /leftCollection=\{m2mForm\.leftCollection\}/);
  assert.match(dataModelSource, /rightCollection=\{m2mForm\.rightCollection\}/);
  assert.match(dataModelSource, /junctionCollection: junction/);
  assert.match(dataModelSource, /leftCollection: m2mForm\.leftCollection/);
  assert.match(dataModelSource, /rightCollection: m2mForm\.rightCollection/);
});

test('RelationDiagram is presentation-only and responsive', () => {
  assert.doesNotMatch(diagramSource, /apiRequest|fetch\(/);
  assert.match(diagramSource, /relation-diagram-canvas/);
  assert.match(diagramSource, /relation-diagram-meta/);
  assert.match(diagramCss, /\.relation-v2-form-with-preview/);
  assert.match(diagramCss, /@media \(max-width: 620px\)/);
});
