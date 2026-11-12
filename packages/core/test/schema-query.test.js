import test from 'node:test';
import assert from 'node:assert/strict';

import { compileFieldColumn } from '../src/field-types.js';
import {
  assertQueryCost,
  compileFilter,
  compileSelectFields,
  compileSort,
  parseItemsQuery,
  queryCost,
  QUERY_LIMITS,
} from '../src/query.js';
import { attachSchemaSnapshot } from '../src/schema.js';

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

test('filter compiler supports bounded M2O relational predicates, self-joins and native user safety', () => {
  const relationalSnapshot = {
    version: 1,
    collections: {
      articles: {
        collection: 'articles',
        primary_key: 'id',
        fields: {
          id: { field: 'id', type: 'uuid' },
          status: { field: 'status', type: 'string' },
          author_id: { field: 'author_id', type: 'uuid' },
          category_id: { field: 'category_id', type: 'uuid' },
        },
      },
      articles_translations: {
        collection: 'articles_translations',
        primary_key: 'id',
        fields: {
          id: { field: 'id', type: 'uuid' },
          articles_id: { field: 'articles_id', type: 'uuid' },
          languages_code: { field: 'languages_code', type: 'string' },
          title: { field: 'title', type: 'string' },
        },
      },
      categories: {
        collection: 'categories',
        primary_key: 'id',
        fields: {
          id: { field: 'id', type: 'uuid' },
          parent_id: { field: 'parent_id', type: 'uuid' },
          status: { field: 'status', type: 'string' },
        },
      },
      yuncms_users: {
        collection: 'yuncms_users',
        primary_key: 'id',
        system: true,
        fields: {
          id: { field: 'id', type: 'uuid' },
          email: { field: 'email', type: 'string' },
          status: { field: 'status', type: 'string' },
          password_hash: { field: 'password_hash', type: 'string' },
        },
      },
    },
    relations: [
      { many_collection: 'articles_translations', many_field: 'articles_id', one_collection: 'articles', one_field: 'id' },
      { many_collection: 'articles', many_field: 'author_id', one_collection: 'yuncms_users', one_field: 'id' },
      { many_collection: 'articles', many_field: 'category_id', one_collection: 'categories', one_field: 'id' },
      { many_collection: 'categories', many_field: 'parent_id', one_collection: 'categories', one_field: 'id' },
    ],
  };

  const childSchema = attachSchemaSnapshot(
    relationalSnapshot.collections.articles_translations,
    relationalSnapshot,
  );

  const singleHop = compileFilter({
    articles_id: { status: { _eq: 'published' } },
  }, childSchema);
  assert.equal(
    singleHop.sql,
    ' WHERE (EXISTS (SELECT 1 FROM `articles` AS `__yrel_1` WHERE `__yrel_1`.`id` = `articles_translations`.`articles_id` AND ((`__yrel_1`.`status` = ?))))',
  );
  assert.deepEqual(singleHop.params, ['published']);

  const mixedMultiHop = compileFilter({
    articles_id: {
      _nnull: true,
      _or: [
        { status: { _eq: 'published' } },
        { author_id: { email: { _ends_with: '@example.com' } } },
      ],
    },
  }, childSchema);
  assert.match(mixedMultiHop.sql, /`articles_id` IS NOT NULL AND EXISTS \(SELECT 1 FROM `articles` AS `__yrel_1`/);
  assert.match(mixedMultiHop.sql, /EXISTS \(SELECT 1 FROM `yuncms_users` AS `__yrel_2` WHERE `__yrel_2`\.`id` = `__yrel_1`\.`author_id`/);
  assert.deepEqual(mixedMultiHop.params, ['published', '%@example.com']);

  const categorySchema = attachSchemaSnapshot(
    relationalSnapshot.collections.categories,
    relationalSnapshot,
  );
  const selfJoin = compileFilter({
    parent_id: { status: { _eq: 'published' } },
  }, categorySchema);
  assert.match(
    selfJoin.sql,
    /EXISTS \(SELECT 1 FROM \(SELECT \* FROM `categories` LIMIT 18446744073709551615\) AS `__yrel_1` WHERE `__yrel_1`\.`id` = `categories`\.`parent_id`/,
  );

  assert.throws(
    () => compileFilter({
      articles_id: { author_id: { password_hash: { _starts_with: '$scrypt' } } },
    }, childSchema),
    (error) => error.code === 'INVALID_QUERY' && error.path === 'filter.articles_id.author_id.password_hash',
  );

  assert.throws(
    () => compileFilter({
      title: { status: { _eq: 'published' } },
    }, childSchema),
    (error) => error.code === 'INVALID_QUERY' && error.path === 'filter.title.status' && /Unknown filter operator/.test(error.message),
  );

  assert.throws(
    () => compileFilter({
      articles_id: { _sql: '1=1' },
    }, childSchema),
    (error) => error.code === 'INVALID_QUERY' && error.path === 'filter.articles_id._sql',
  );

  const fourHops = {
    parent_id: { parent_id: { parent_id: { parent_id: { status: { _eq: 'published' } } } } },
  };
  assert.equal(compileFilter(fourHops, categorySchema).params.length, 1);

  const fiveHops = {
    parent_id: fourHops,
  };
  assert.throws(
    () => compileFilter(fiveHops, categorySchema),
    (error) => error.code === 'INVALID_QUERY' && /Filter relation depth cannot exceed/.test(error.message),
  );

  const flatCost = queryCost({ limit: 10, filter: { status: { _eq: 'published' } } });
  const relCost = queryCost({ limit: 10, filter: { articles_id: { category_id: { status: { _eq: 'published' } } } } });
  assert.equal(relCost - flatCost, 2 * 50 + 2 * 100);
  assert.throws(
    () => assertQueryCost({ limit: 500, filter: fourHops }, { maxCost: 600 }),
    (error) => error.code === 'QUERY_COST_LIMIT',
  );
});
