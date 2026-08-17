import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';

const routeSource = readFileSync(resolve(import.meta.dirname, '../src/routes/system-schema.js'), 'utf8');
const appSource = readFileSync(resolve(import.meta.dirname, '../src/app.js'), 'utf8');

test('system collection field creation uses the dedicated bounded service', () => {
  assert.match(routeSource, /system-collections\/:collection\/fields/);
  assert.match(routeSource, /SystemCollectionFieldsService/);
  assert.match(routeSource, /schemaCache\?\.clear\(\)/);
  assert.match(routeSource, /schema\.system-field\.create/);
});

test('system schema router is mounted before the generic schema router', () => {
  const systemIndex = appSource.indexOf("createSystemSchemaRouter({ schemaCache })");
  const genericIndex = appSource.indexOf("createSchemaRouter({ schemaCache })");
  assert.ok(systemIndex >= 0);
  assert.ok(genericIndex > systemIndex);
});
