import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';

const source = readFileSync(resolve(import.meta.dirname, '../src/routes/schema.js'), 'utf8');

test('schema API exposes audited create and delete routes for one-to-one relations', () => {
  assert.match(source, /router\.post\('\/relations\/o2o'/);
  assert.match(source, /createO2ORelation/);
  assert.match(source, /schema\.relation\.o2o\.create/);
  assert.match(source, /router\.delete\('\/relations\/o2o\/:manyCollection\/:manyField'/);
  assert.match(source, /deleteO2ORelation/);
  assert.match(source, /schema\.relation\.o2o\.delete/);
});
