import assert from 'node:assert/strict';
import test from 'node:test';
import { assertFieldIndexOptions, assertNoDuplicateFieldValues, fieldIndexClause, safeFieldIndexError } from '../src/field-index.js';
import { assertSchemaDDLAllowed } from '../src/schema-ddl.js';
import { withConnectionTransaction } from '../src/transaction.js';

test('unique and ordinary indexes use the full scalar value and a bounded stable owned name', () => {
  const ordinary = fieldIndexClause('articles', 'slug', { indexed: true });
  const unique = fieldIndexClause('articles', 'slug', { unique: true, indexed: true });
  assert.match(ordinary, /^ADD INDEX `yidx_[a-f0-9]{24}` \(`slug`\)$/);
  assert.equal(unique, ordinary.replace('ADD INDEX', 'ADD UNIQUE INDEX'));
  assert.equal(fieldIndexClause('articles', 'slug', { unique: false, indexed: false }), null);
  assert.throws(() => fieldIndexClause('articles', 'slug`); DROP TABLE users', { unique: true }));
});

test('full-value indexing excludes unsupported storage without rejecting explicit false', () => {
  for (const type of ['text', 'json']) {
    assert.throws(() => assertFieldIndexOptions({ type, unique: true }), { code: 'INVALID_SCHEMA_PAYLOAD' });
    assert.doesNotThrow(() => assertFieldIndexOptions({ type, unique: false }));
  }
  assert.doesNotThrow(() => assertFieldIndexOptions({ type: 'string', length: 768, unique: true }));
  assert.throws(() => assertFieldIndexOptions({ type: 'string', length: 769, indexed: true }), { code: 'INVALID_SCHEMA_PAYLOAD' });
});

test('duplicate preflight selects no business values, excludes NULL and safely quotes identifiers', async () => {
  let sql;
  await assert.rejects(assertNoDuplicateFieldValues({ async query(value) { sql = value; return [[{ duplicate: 1 }]]; } }, 'articles', 'slug'), {
    code: 'DUPLICATE_KEY', message: 'Existing non-null values conflict with the unique constraint',
  });
  assert.match(sql, /SELECT 1 AS duplicate FROM `articles` WHERE `slug` IS NOT NULL GROUP BY `slug` HAVING COUNT\(\*\) > 1 LIMIT 1/);
  await assertNoDuplicateFieldValues({ async query() { return [[]]; } }, 'articles', 'slug');
  await assert.rejects(assertNoDuplicateFieldValues({ query() { throw Error('Must not query'); } }, 'articles`;--', 'slug'));
});

test('DDL duplicate errors have a typed safe service message without exposing business values', () => {
  const error = Object.assign(Error("Duplicate entry 'private-key'"), { code: 'ER_DUP_ENTRY' });
  const safe = safeFieldIndexError(error);
  assert.equal(safe.code, 'DUPLICATE_KEY'); assert.equal(safe.message.includes('private-key'), false); assert.equal(safe.cause, error);
  const partial = Object.assign(Error('Compensation failed'), { code: 'SCHEMA_PARTIAL_FAILURE' });
  assert.equal(safeFieldIndexError(partial), partial);
});

test('physical schema changes cannot implicitly commit an active managed transaction', async () => {
  let rollback = false, commit = false;
  const connection = { async beginTransaction() {}, async rollback() { rollback = true; }, async commit() { commit = true; } };
  assert.doesNotThrow(() => assertSchemaDDLAllowed(connection));
  await assert.rejects(withConnectionTransaction(connection, async () => assertSchemaDDLAllowed(connection)), { code: 'INVALID_SCHEMA_PAYLOAD' });
  assert.equal(rollback, true); assert.equal(commit, false);
  assert.doesNotThrow(() => assertSchemaDDLAllowed(connection));
});
