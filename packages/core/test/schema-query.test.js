import test from 'node:test';
import assert from 'node:assert/strict';

import { compileFieldColumn } from '../src/field-types.js';
import { compileFilter, compileSelectFields, compileSort, parseItemsQuery } from '../src/query.js';

const schema = {
  fields: {
    id: { field: 'id', type: 'uuid' },
    status: { field: 'status', type: 'string' },
    amount: { field: 'amount', type: 'decimal' },
    title: { field: 'title', type: 'string' },
  },
};

test('field compiler allowlists mysql types and keeps defaults parameterized', () => {
  assert.deepEqual(
    compileFieldColumn({ type: 'string', length: 120, required: true, defaultValue: 'draft' }),
    {
      sql: 'VARCHAR(120) NOT NULL DEFAULT ?',
      params: ['draft'],
      schemaMetadata: {
        length: 120,
        precision: undefined,
        scale: undefined,
        defaultValue: 'draft',
        defaultPreset: undefined,
        autoUpdate: undefined,
      },
    },
  );
  assert.throws(() => compileFieldColumn({ type: 'raw_sql' }), /Unsupported field type/);
  assert.throws(() => compileFieldColumn({ type: 'decimal', precision: 2, scale: 3 }), /cannot exceed precision/);
});

test('items query parser rejects unknown parameters and clamps shape', () => {
  const parsed = parseItemsQuery({
    fields: 'id,title',
    filter: '{"status":{"_eq":"active"}}',
    sort: '-title',
    limit: '25',
    offset: '10',
  });

  assert.deepEqual(parsed.fields, ['id', 'title']);
  assert.equal(parsed.limit, 25);
  assert.equal(parsed.offset, 10);
  assert.deepEqual(parsed.filter, { status: { _eq: 'active' } });
  assert.throws(() => parseItemsQuery({ raw: 'sql' }), /Unknown query parameter/);
  assert.throws(() => parseItemsQuery({ limit: 9999 }), /limit must be an integer/);
});

test('select and sort compilers resolve only schema fields', () => {
  assert.equal(compileSelectFields(['id', 'title'], schema).sql, '`id`, `title`');
  assert.equal(compileSort(['-title', 'status'], schema), ' ORDER BY `title` DESC, `status` ASC');
  assert.throws(() => compileSelectFields(['password'], schema), /Unknown field/);
  assert.throws(() => compileSort(['created_at'], schema), /Unknown field/);
});

test('filter compiler parameterizes values and fails closed on operators', () => {
  const compiled = compileFilter({
    status: { _eq: 'active' },
    amount: { _gte: 10 },
    _or: [
      { title: { _contains: '100%_safe' } },
      { status: { _in: ['draft', 'review'] } },
    ],
  }, schema);

  assert.match(compiled.sql, /`status` = \?/);
  assert.match(compiled.sql, /`amount` >= \?/);
  assert.match(compiled.sql, /LIKE \?/);
  assert.deepEqual(compiled.params, ['active', 10, '%100\\%\\_safe%', 'draft', 'review']);
  assert.throws(() => compileFilter({ status: { _sql: '1=1' } }, schema), /Unknown filter operator/);
  assert.throws(() => compileFilter({ missing: { _eq: 1 } }, schema), /Unknown field/);
});
