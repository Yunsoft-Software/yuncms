import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';

const source = readFileSync(resolve(import.meta.dirname, '../src/screens/ContentScreen.jsx'), 'utf8');

test('collection switches synchronously block stale item loads until the new schema is ready', () => {
  assert.match(source, /const schemaLoadingRef = useRef\(true\)/);
  assert.match(source, /const version = \+\+requestVersion\.current;\s+schemaLoadingRef\.current = true;/);
  assert.match(source, /schemaLoadingRef\.current = false;\s+setSchemaLoading\(false\);/);
  assert.match(
    source,
    /if \(!collection \|\| schemaLoading \|\| schemaLoadingRef\.current \|\| fields\.length === 0\) return;/,
  );
});
