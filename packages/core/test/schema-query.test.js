import test from 'node:test';
import assert from 'node:assert/strict';

import { compileFieldColumn } from '../src/field-types.js';
import {
  compileFilter,
  compileSelectFields,
  compileSort,
  parseItemsQuery,
  QUERY_LIMITS,
} from '../src/query.js';

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
  assert.deepEqual(parseItemsQuery({ fields: '*' }).fields, ['*']);
  assert.throws(() => parseItemsQuery({ raw: 'sql' }), /Unknown query parameter/);
  assert.throws(() => parseItemsQuery({ limit: 9999 }), /limit must be an integer/);
  assert.throws(() => parseItemsQuery({ limit: ['25'] }), /limit must be an integer/);
  assert.throws(() => parseItemsQuery({ offset: ['10'] }), /offset must be an integer/);
  for (const field of ['limit', 'offset']) {
    for (const value of [true, false, {}, { valueOf: () => 10 }, [], ['10', '20']]) {
      assert.throws(() => parseItemsQuery({ [field]: value }), (error) => error.code === 'INVALID_QUERY');
    }
  }
  assert.equal(parseItemsQuery({ limit: '25', offset: '10' }).limit, 25);
  assert.equal(parseItemsQuery({ limit: 25, offset: 0 }).offset, 0);
  assert.throws(
    () => parseItemsQuery({ offset: QUERY_LIMITS.maxOffset + 1 }),
    /offset must be an integer/,
  );
  assert.throws(
    () => parseItemsQuery({ fields: Array.from({ length: QUERY_LIMITS.maxFields + 1 }, () => 'id') }),
    /fields cannot contain more than/,
  );
  assert.throws(
    () => parseItemsQuery({ sort: Array.from({ length: QUERY_LIMITS.maxSortFields + 1 }, () => 'title') }),
    /sort cannot contain more than/,
  );
});

test('select and sort compilers resolve only schema fields', () => {
  assert.equal(compileSelectFields(['id', 'title'], schema).sql, '`id`, `title`');
  assert.equal(compileSelectFields(['*'], schema).sql, '`id`, `status`, `amount`, `title`');
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

test('filter compiler resolves contextual identities and deterministic time values as parameters', () => {
  const now = new Date('2026-09-05T10:20:30.000Z');
  const compiled = compileFilter({
    _and: [
      { id: { _eq: '$CURRENT_USER' } },
      { status: { _eq: '$CURRENT_ROLE' } },
      { amount: { _lte: '$NOW(+2 hours)' } },
    ],
  }, schema, {
    dynamicVariables: { user: 'user-1', role: 'role-1', now },
  });

  assert.equal(compiled.sql.includes('$CURRENT'), false);
  assert.deepEqual(compiled.params.slice(0, 2), ['user-1', 'role-1']);
  assert.equal(compiled.params[2] instanceof Date, true);
  assert.equal(compiled.params[2].toISOString(), '2026-09-05T12:20:30.000Z');
});

test('dynamic identity variables fail closed and malformed or nested values are rejected', () => {
  assert.throws(
    () => compileFilter({ id: { _eq: '$CURRENT_USER' } }, schema),
    (error) => error.code === 'FORBIDDEN' && error.path === 'filter.id._eq',
  );
  assert.throws(
    () => compileFilter({ amount: { _lte: '$NOW(next week)' } }, schema),
    (error) => error.code === 'INVALID_QUERY' && /signed adjustment/.test(error.message),
  );
  assert.throws(
    () => compileFilter({ id: { _eq: '$CURRENT_USER.email' } }, schema, {
      allowUnresolvedDynamicVariables: true,
    }),
    (error) => error.code === 'INVALID_QUERY' && /Nested current-user/.test(error.message),
  );
});

test('filter compiler rejects oversized IN lists and excessive nesting', () => {
  assert.throws(
    () => compileFilter({
      status: { _in: Array.from({ length: QUERY_LIMITS.maxInValues + 1 }, (_, index) => `s-${index}`) },
    }, schema),
    /accepts at most/,
  );

  let nested = { status: { _eq: 'active' } };
  for (let index = 0; index < QUERY_LIMITS.maxFilterDepth; index += 1) {
    nested = { _and: [nested] };
  }

  assert.throws(() => compileFilter(nested, schema), /Filter depth cannot exceed/);
});

test('filter compiler rejects excessive logical node counts', () => {
  const filter = {
    _or: Array.from(
      { length: QUERY_LIMITS.maxFilterNodes },
      (_, index) => ({ status: { _eq: `state-${index}` } }),
    ),
  };

  assert.throws(() => compileFilter(filter, schema), /Filter cannot contain more than/);
});

test('datetime comparisons normalize ISO offsets using trusted field types and bound parameters', () => {
  const dates = { fields: { at: { type: 'datetime' }, ts: { type: 'timestamp' }, text: { type: 'string' } } };
  for (const field of ['at', 'ts']) {
    for (const operator of ['_eq', '_neq', '_lt', '_lte', '_gt', '_gte', '_in', '_nin']) {
      const iso = '2026-08-31T07:56:17.687+03:00';
      const compiled = compileFilter({ [field]: { [operator]: operator === '_in' || operator === '_nin' ? [iso] : iso } }, dates);
      assert.equal(compiled.params[0].toISOString(), '2026-08-31T04:56:17.687Z');
      assert.ok(!compiled.sql.includes(iso));
    }
    assert.deepEqual(compileFilter({ [field]: { _lt: '2026-08-31 04:56:17.687' } }, dates).params, ['2026-08-31 04:56:17.687']);
    assert.deepEqual(compileFilter({ [field]: { _null: true } }, dates).params, []);
    const now = new Date('2026-09-30T00:00:00.000Z');
    assert.equal(compileFilter({ [field]: { _lt: '$NOW' } }, dates, { dynamicVariables: { now } }).params[0].toISOString(), now.toISOString());
    assert.deepEqual(compileFilter({ [field]: { _lte: '$NOW(+1 hour)' } }, dates, { allowUnresolvedDynamicVariables: true }).params, ['$NOW(+1 hour)']);
    assert.throws(() => compileFilter({ [field]: { _lt: '$NOW(next week)' } }, dates, { allowUnresolvedDynamicVariables: true }), (error) => error.code === 'INVALID_QUERY');
    for (const value of ['bad', '2026-02-30T00:00:00Z', '2026-13-01T00:00:00Z', '2026-01-01T24:00:00Z', '2026-01-01T00:00:00', '2026-01-01T00:00:00+25:00', 1, {}, new Date(NaN), "2026-01-01T00:00:00Z' OR 1=1"]) {
      assert.throws(() => compileFilter({ [field]: { _in: [value] } }, dates), (error) => error.code === 'INVALID_QUERY' && error.path === `filter.${field}._in`);
    }
  }
  assert.deepEqual(compileFilter({ text: { _eq: '2026-08-31T04:56:17.687Z' } }, dates).params, ['2026-08-31T04:56:17.687Z']);
});
