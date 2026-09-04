import assert from 'node:assert/strict';
import test from 'node:test';

import {
  enforcePermissionValidation,
  evaluatePermissionValidation,
} from '../src/permission-validation.js';

const schema = {
  primary_key: 'id',
  fields: {
    id: { field: 'id', type: 'uuid' },
    title: { field: 'title', type: 'string' },
    status: { field: 'status', type: 'string' },
    score: { field: 'score', type: 'integer' },
    owner_id: { field: 'owner_id', type: 'uuid' },
    publish_at: { field: 'publish_at', type: 'datetime' },
  },
};

test('permission validation supports logical and field operators', () => {
  const rule = {
    _and: [
      { status: { _eq: 'active' } },
      {
        _or: [
          { score: { _gte: 10 } },
          { title: { _starts_with: 'Priority' } },
        ],
      },
    ],
  };

  assert.equal(evaluatePermissionValidation({ status: 'active', score: 12, title: 'Normal' }, rule, schema), true);
  assert.equal(evaluatePermissionValidation({ status: 'active', score: 1, title: 'Priority item' }, rule, schema), true);
  assert.equal(evaluatePermissionValidation({ status: 'draft', score: 99, title: 'Priority item' }, rule, schema), false);
});

test('failed permission validation throws stable validation error', () => {
  assert.throws(
    () => enforcePermissionValidation(
      { status: 'draft' },
      { status: { _eq: 'active' } },
      schema,
    ),
    (error) => error.code === 'VALIDATION_FAILED' && error.path === 'validation',
  );
});

test('invalid validation rules reuse safe filter schema validation', () => {
  assert.throws(
    () => evaluatePermissionValidation(
      { status: 'active' },
      { secret: { _eq: true } },
      schema,
    ),
    (error) => error.code === 'INVALID_QUERY',
  );
});

test('permission validation resolves current user and NOW adjustments against one context', () => {
  const dynamicVariables = {
    user: 'user-1',
    role: 'role-1',
    now: new Date('2026-09-05T12:00:00.000Z'),
  };
  const rule = {
    _and: [
      { owner_id: { _eq: '$CURRENT_USER' } },
      { publish_at: { _lte: '$NOW(+1 hour)' } },
    ],
  };

  assert.equal(evaluatePermissionValidation({
    owner_id: 'user-1',
    publish_at: new Date('2026-09-05T12:30:00.000Z'),
  }, rule, schema, { dynamicVariables }), true);
  assert.equal(evaluatePermissionValidation({
    owner_id: 'user-2',
    publish_at: new Date('2026-09-05T12:30:00.000Z'),
  }, rule, schema, { dynamicVariables }), false);
  assert.equal(evaluatePermissionValidation({
    owner_id: 'user-1',
    publish_at: new Date('2026-09-05T13:30:00.000Z'),
  }, rule, schema, { dynamicVariables }), false);
});
