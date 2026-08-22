import assert from 'node:assert/strict';
import test from 'node:test';

import {
  assertQueryCost,
  compileAggregate,
  compileSearch,
  parseItemsQuery,
} from '../src/query.js';

const schema = {
  fields: {
    id: { field: 'id', type: 'uuid' },
    title: { field: 'title', type: 'string' },
    body: { field: 'body', type: 'text' },
    amount: { field: 'amount', type: 'decimal' },
    status: { field: 'status', type: 'string' },
  },
};

test('advanced query parser normalizes search aggregate and groupBy', () => {
  const query = parseItemsQuery({
    search: 'needle',
    aggregate: { count: '*', sum: 'amount' },
    groupBy: 'status',
  });
  assert.equal(query.search, 'needle');
  assert.deepEqual(query.aggregate, { count: ['*'], sum: ['amount'] });
  assert.deepEqual(query.groupBy, ['status']);
  assert.throws(() => parseItemsQuery({ groupBy: 'status' }), /requires aggregate/);
});

test('search is permission-schema bounded and parameterized', () => {
  const compiled = compileSearch('100%_safe', schema);
  assert.match(compiled.sql, /`title` LIKE \?/);
  assert.match(compiled.sql, /`body` LIKE \?/);
  assert.equal(compiled.params[0], '%100\\%\\_safe%');
  assert.doesNotMatch(compiled.sql, /amount/);
});

test('aggregate compiler allowlists functions and fields', () => {
  const compiled = compileAggregate({ count: ['*'], sum: ['amount'] }, ['status'], schema);
  assert.match(compiled.sql, /COUNT\(\*\)/);
  assert.match(compiled.sql, /SUM\(`amount`\)/);
  assert.equal(compiled.groupSql, ' GROUP BY `status`');
  assert.throws(() => compileAggregate({ sum: ['missing'] }, null, schema), /Unknown field/);
  assert.throws(() => parseItemsQuery({ aggregate: { sql: '1' } }), /Unknown aggregate function/);
});

test('query cost rejects transformed queries that exceed the budget', () => {
  const query = parseItemsQuery({ limit: 500, aggregate: { count: '*', sum: 'amount' } });
  assert.throws(() => assertQueryCost(query, { maxCost: 100 }), (error) => error.code === 'QUERY_COST_LIMIT');
});
