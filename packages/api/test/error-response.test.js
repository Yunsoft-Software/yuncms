import test from 'node:test';
import assert from 'node:assert/strict';

import { errorBody, normalizeApiError, statusForError } from '../src/error-response.js';
import { hashExternalAuthState } from '@yunsoft/yuncms-core';

test('known client errors map to stable http statuses', () => {
  assert.equal(statusForError({ code: 'INVALID_QUERY' }), 400);
  assert.equal(statusForError({ code: 'FILE_MIME_MISMATCH' }), 400);
  assert.equal(statusForError({ code: 'FORBIDDEN' }), 403);
  assert.equal(statusForError({ code: 'COLLECTION_NOT_FOUND' }), 404);
  assert.equal(statusForError({ code: 'DUPLICATE_KEY' }), 409);
});

test('malformed external auth state is a safe client error', () => {
  let error;
  try { hashExternalAuthState('invalid-test'); } catch (caught) { error = caught; }
  assert.equal(error.code, 'INVALID_AUTH_TRANSACTION');
  assert.equal(statusForError(error), 400);
  assert.equal(errorBody(error, 'oauth-test').errors[0].message, 'External auth state is invalid');
});

test('external auth validation and permission errors have controlled statuses', () => {
  for (const code of ['INVALID_AUTH_TRANSACTION', 'INVALID_AUTH_PROVIDER', 'INVALID_EXTERNAL_IDENTITY', 'INVALID_REDIRECT_TARGET', 'AUTH_PROVIDER_FLOW_MISMATCH']) {
    assert.equal(statusForError({ code }), 400, code);
  }
  assert.equal(statusForError({ code: 'AUTH_PROVIDER_NOT_FOUND' }), 404);
  for (const code of ['VERIFIED_EXTERNAL_EMAIL_REQUIRED', 'EXTERNAL_USER_INACTIVE', 'EXTERNAL_ADMIN_LINK_FORBIDDEN', 'EXTERNAL_IDENTITY_NOT_LINKED']) {
    assert.equal(statusForError({ code }), 403, code);
  }
  assert.equal(statusForError({ code: 'EXTERNAL_EMAIL_CONFLICT' }), 409);
  for (const code of ['INVALID_AUTH_PROVIDER_CONFIG', 'EXTERNAL_JIT_ROLE_REQUIRED', 'INVALID_EXTERNAL_JIT_ROLE']) {
    assert.equal(statusForError({ code }), 503, code);
    assert.equal(errorBody({ code, message: 'private configuration detail' }, 'req').errors[0].message, 'Internal server error');
  }
  for (const code of ['EXTERNAL_IDENTITY_INVALID', 'EXTERNAL_USERINFO_FAILED']) {
    assert.equal(statusForError({ code }), 502, code);
  }
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

test('malformed JSON is a safe 400 client error', () => {
  const parseError = new SyntaxError('Unexpected token with raw request content');
  parseError.type = 'entity.parse.failed';

  const normalized = normalizeApiError(parseError);
  assert.equal(normalized.code, 'INVALID_PAYLOAD');
  assert.equal(statusForError(normalized), 400);
  assert.equal(normalized.message, 'Request body contains invalid JSON');
  assert.doesNotMatch(normalized.message, /raw request content/);
});
