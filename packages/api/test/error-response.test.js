import test from 'node:test';
import assert from 'node:assert/strict';

import { errorBody, statusForError } from '../src/error-response.js';

test('known client errors map to stable http statuses', () => {
  assert.equal(statusForError({ code: 'INVALID_QUERY' }), 400);
  assert.equal(statusForError({ code: 'FORBIDDEN' }), 403);
  assert.equal(statusForError({ code: 'COLLECTION_NOT_FOUND' }), 404);
});

test('unknown internal errors do not expose server messages', () => {
  const body = errorBody(new Error('database password leaked here'), 'req-1');

  assert.deepEqual(body, {
    errors: [
      {
        code: 'INTERNAL_ERROR',
        message: 'Internal server error',
        request_id: 'req-1',
      },
    ],
  });
});

test('client error includes path and request id', () => {
  const error = new Error('Unknown field: secret');
  error.code = 'INVALID_QUERY';
  error.path = 'filter.secret';

  assert.deepEqual(errorBody(error, 'req-2'), {
    errors: [
      {
        code: 'INVALID_QUERY',
        message: 'Unknown field: secret',
        path: 'filter.secret',
        request_id: 'req-2',
      },
    ],
  });
});
