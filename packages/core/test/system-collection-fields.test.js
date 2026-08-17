import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';

import {
  assertExtensibleSystemCollection,
  assertSystemExtensionInput,
} from '../src/services/system-collection-fields-service.js';

const serviceSource = readFileSync(resolve(import.meta.dirname, '../src/services/system-collection-fields-service.js'), 'utf8');

test('only explicitly permission-managed system collections are extensible', () => {
  assert.doesNotThrow(() => assertExtensibleSystemCollection({
    collection: 'yuncms_users',
    system: 1,
    metadata: { permissionManaged: true, allowedActions: ['read', 'update'] },
  }));
  assert.throws(
    () => assertExtensibleSystemCollection({ collection: 'yuncms_sessions', system: 1, metadata: null }),
    (error) => error.code === 'SYSTEM_SCHEMA_READ_ONLY',
  );
  assert.throws(
    () => assertExtensibleSystemCollection({ collection: 'articles', system: 0, metadata: {} }),
    (error) => error.code === 'SYSTEM_SCHEMA_READ_ONLY',
  );
});

test('custom system extension fields are optional-only so existing system rows remain valid', () => {
  assert.doesNotThrow(() => assertSystemExtensionInput({ required: false }));
  assert.doesNotThrow(() => assertSystemExtensionInput({}));
  assert.throws(
    () => assertSystemExtensionInput({ required: true }),
    (error) => error.code === 'SYSTEM_EXTENSION_REQUIRED_UNSUPPORTED',
  );
});

test('system extension creation is schema-locked, normalized and tagged in metadata', () => {
  assert.match(serviceSource, /resolveSchemaName/);
  assert.match(serviceSource, /displayName:\s*input\.name \?\? input\.field/);
  assert.match(serviceSource, /name,\n\s*type:/);
  assert.match(serviceSource, /withAdvisoryLock\(this\.database, 'yuncms:schema'/);
  assert.match(serviceSource, /ALTER TABLE \$\{table\} ADD COLUMN \$\{column\}/);
  assert.match(serviceSource, /systemExtension:\s*true/);
  assert.match(serviceSource, /required:\s*false/);
  assert.match(serviceSource, /DROP COLUMN/);
  assert.match(serviceSource, /assertSchemaManager\(this\.accountability\)/);
});
