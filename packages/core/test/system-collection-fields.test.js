import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';

import { assertExtensibleSystemCollection } from '../src/services/system-collection-fields-service.js';

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

test('system extension creation is schema-locked, physically added and tagged in metadata', () => {
  assert.match(serviceSource, /withAdvisoryLock\(this\.database, 'yuncms:schema'/);
  assert.match(serviceSource, /ALTER TABLE \$\{table\} ADD COLUMN \$\{column\}/);
  assert.match(serviceSource, /systemExtension:\s*true/);
  assert.match(serviceSource, /DROP COLUMN/);
  assert.match(serviceSource, /assertSchemaManager\(this\.accountability\)/);
});
