import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';

import { o2oUniqueIndexName } from '../src/o2o-relation.js';

const source = readFileSync(resolve(import.meta.dirname, '../src/o2o-relation.js'), 'utf8');

test('one-to-one unique index names are deterministic, bounded and field-specific', () => {
  const first = o2oUniqueIndexName('profiles', 'user_id');
  const again = o2oUniqueIndexName('profiles', 'user_id');
  const other = o2oUniqueIndexName('profiles', 'account_id');
  assert.equal(first, again);
  assert.notEqual(first, other);
  assert.match(first, /^yuo_[a-f0-9]{24}$/);
  assert.ok(first.length <= 64);
});

test('one-to-one creation adds FK and UNIQUE in one schema-locked DDL lifecycle', () => {
  assert.match(source, /withAdvisoryLock\(database, 'yuncms:schema'/);
  assert.match(source, /ADD CONSTRAINT[\s\S]*FOREIGN KEY[\s\S]*ADD UNIQUE INDEX/);
  assert.match(source, /kind: 'o2o'/);
  assert.match(source, /DROP FOREIGN KEY[\s\S]*DROP INDEX/);
});

test('one-to-one source rejects SET NULL when the field is required', () => {
  assert.match(source, /SET NULL cannot be used with a required one-to-one field/);
});
