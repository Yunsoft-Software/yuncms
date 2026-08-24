import { normalizeDatabaseError } from '@yunsoft/yuncms-core';

const STATUS_BY_CODE = new Map([
  ['INVALID_CREDENTIALS', 401],
  ['UNAUTHORIZED', 401],
  ['FORBIDDEN', 403],
  ['FORBIDDEN_FIELD', 403],
  ['SELF_ADMIN_MUTATION_FORBIDDEN', 403],
  ['PROTECTED_ROLE', 403],
  ['SYSTEM_SCHEMA_READ_ONLY', 403],
  ['COLLECTION_NOT_FOUND', 404],
  ['FIELD_NOT_FOUND', 404],
  ['RELATION_NOT_FOUND', 404],
  ['USER_NOT_FOUND', 404],
  ['ROLE_NOT_FOUND', 404],
  ['PERMISSION_NOT_FOUND', 404],
  ['FILE_NOT_FOUND', 404],
  ['NAVIGATION_GROUP_NOT_FOUND', 404],
  ['NOT_FOUND', 404],
  ['COLLECTION_EXISTS', 409],
  ['FIELD_EXISTS', 409],
  ['RELATION_EXISTS', 409],
  ['COLLECTION_HAS_RELATIONS', 409],
  ['M2M_JUNCTION_INVALID', 409],
  ['STORAGE_INVENTORY_LIMIT', 409],
  ['PUBLIC_ROLE_EXISTS', 409],
  ['ROLE_IN_USE', 409],
  ['SCHEMA_METADATA_DRIFT', 409],
  ['DUPLICATE_KEY', 409],
  ['FOREIGN_KEY_MISSING', 409],
  ['FOREIGN_KEY_RESTRICTED', 409],
  ['SINGLETON_ITEM_EXISTS', 409],
  ['SINGLETON_MULTIPLE_ITEMS', 409],
  ['SINGLETON_BULK_CREATE_FORBIDDEN', 409],
  ['RATE_LIMITED', 429],
  ['PAYLOAD_TOO_LARGE', 413],
  ['INVALID_QUERY', 400],
  ['INVALID_PAYLOAD', 400],
  ['INVALID_PASSWORD', 400],
  ['INVALID_TOKEN', 400],
  ['INVALID_ROLE', 400],
  ['INVALID_PERMISSION', 400],
  ['INVALID_SCHEMA_PAYLOAD', 400],
  ['INVALID_AUDIT_EVENT', 400],
  ['INVALID_ON_DELETE', 400],
  ['INVALID_STORAGE_KEY', 400],
  ['INVALID_FILE_CONTENT', 400],
  ['FILE_MIME_MISMATCH', 400],
  ['INVALID_MAIL_MESSAGE', 400],
  ['INVALID_AI_REQUEST', 400],
  ['INVALID_AI_CONFIG', 400],
  ['AI_TOOL_ARGUMENTS_INVALID', 400],
  ['STORAGE_NOT_FOUND', 400],
  ['STORAGE_INVENTORY_UNSUPPORTED', 400],
  ['UNSUPPORTED_SCHEMA_UPDATE', 400],
  ['UNSUPPORTED_FIELD_TYPE', 400],
  ['UNSUPPORTED_FIELD_DEFAULT', 400],
  ['UNSUPPORTED_PRIMARY_KEY', 400],
  ['UNSUPPORTED_RELATION_TARGET', 400],
  ['UNSUPPORTED_RELATION_EXPANSION', 400],
  ['RELATION_TYPE_MISMATCH', 400],
  ['DESTRUCTIVE_OPERATION_REQUIRED', 400],
  ['REQUIRED_FIELD_MISSING', 400],
  ['FIELD_READ_ONLY', 400],
  ['FILTER_REQUIRED', 400],
  ['VALIDATION_FAILED', 400],
  ['VALIDATION_BULK_LIMIT', 400],
  ['AI_PROVIDER_UNAVAILABLE', 502],
  ['AI_PROVIDER_RESPONSE_INVALID', 502],
  ['AI_TOOL_ROUND_LIMIT', 502],
  ['AI_TOOL_CALL_LIMIT', 502],
  ['AI_PROVIDER_TIMEOUT', 504],
  ['AI_NOT_CONFIGURED', 503],
  ['AI_SETTINGS_KEY_INVALID', 503],
  ['AI_SECRET_DECRYPT_FAILED', 503],
  ['MAIL_NOT_CONFIGURED', 503],
  ['STORAGE_INVENTORY_FAILED', 503],
  ['DATABASE_MIGRATION_REQUIRED', 503],
  ['DEADLOCK', 503],
  ['LOCK_WAIT_TIMEOUT', 503],
  ['CONNECTION_LOST', 503],
  ['CONNECTION_REFUSED', 503],
]);

const MYSQL_CODES = new Set([
  'ER_DUP_ENTRY',
  'ER_NO_REFERENCED_ROW_2',
  'ER_ROW_IS_REFERENCED_2',
  'ER_LOCK_DEADLOCK',
  'ER_LOCK_WAIT_TIMEOUT',
  'PROTOCOL_CONNECTION_LOST',
  'ECONNREFUSED',
]);

const SAFE_DATABASE_MESSAGES = new Map([
  ['DUPLICATE_KEY', 'A record with the same unique value already exists'],
  ['FOREIGN_KEY_MISSING', 'A referenced record does not exist'],
  ['FOREIGN_KEY_RESTRICTED', 'The record is still referenced and cannot be removed'],
  ['DEADLOCK', 'The database transaction could not complete; retry the request'],
  ['LOCK_WAIT_TIMEOUT', 'The database operation timed out waiting for a lock'],
  ['CONNECTION_LOST', 'Database connection was lost'],
  ['CONNECTION_REFUSED', 'Database connection is unavailable'],
]);

function normalizeApiError(error) {
  if (error?.type === 'entity.parse.failed') {
    const normalized = new Error('Request body contains invalid JSON');
    normalized.code = 'INVALID_PAYLOAD';
    normalized.cause = error;
    return normalized;
  }
  if (error?.type === 'entity.too.large') {
    const normalized = new Error('Request body exceeds the configured upload limit');
    normalized.code = 'PAYLOAD_TOO_LARGE';
    normalized.cause = error;
    return normalized;
  }
  if (!MYSQL_CODES.has(error?.code)) return error;
  const databaseError = normalizeDatabaseError(error);
  const normalized = new Error(
    SAFE_DATABASE_MESSAGES.get(databaseError.code) ?? 'Database operation failed',
  );
  normalized.code = databaseError.code;
  normalized.cause = databaseError;
  return normalized;
}

export function statusForError(error) {
  return STATUS_BY_CODE.get(error?.code) ?? 500;
}

export function errorBody(error, requestId) {
  const status = statusForError(error);
  const exposeMessage = status < 500;

  return {
    errors: [
      {
        code: error?.code ?? 'INTERNAL_ERROR',
        message: exposeMessage ? (error?.message ?? 'Request failed') : 'Internal server error',
        ...(error?.path ? { path: error.path } : {}),
        request_id: requestId,
      },
    ],
  };
}

export function apiErrorHandler(logger = console) {
  return (error, req, res, _next) => {
    const normalized = normalizeApiError(error);
    const status = statusForError(normalized);

    if (status >= 500) {
      logger.error?.('YunCMS API request failed', {
        requestId: req.id,
        code: normalized?.code,
        error,
      });
    }

    res.status(status).json(errorBody(normalized, req.id));
  };
}

export { normalizeApiError };
