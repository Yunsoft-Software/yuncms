import test from 'node:test';
import assert from 'node:assert/strict';

import { errorBody, normalizeApiError, statusForError } from '../src/error-response.js';

test('known client errors map to stable http statuses', () => {
  assert.equal(statusForError({ code: 'INVALID_QUERY' }), 400);
  assert.equal(statusForError({ code: 'FORBIDDEN' }), 403);
  assert.equal(statusForError({ code: 'COLLECTION_NOT_FOUND' }), 404);
  assert.equal(statusForError({ code: 'DUPLICATE_KEY' }), 409);
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

test('raw MySQL duplicate errors become safe conflict errors', () => {
  const mysqlError = new Error("Duplicate entry 'secret@example.com' for key 'uq_users_email'");
  mysqlError.code = 'ER_DUP_ENTRY';
  mysqlError.errno = 1062;

  const normalized = normalizeApiError(mysqlError);
  assert.equal(normalized.code, 'DUPLICATE_KEY');
  assert.equal(statusForError(normalized), 409);
  assert.equal(normalized.message, 'A record with the same unique value already exists');
  assert.doesNotMatch(normalized.message, /secret@example\.com/);
});
