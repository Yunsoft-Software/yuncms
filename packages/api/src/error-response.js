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
  ['NOT_FOUND', 404],
  ['COLLECTION_EXISTS', 409],
  ['FIELD_EXISTS', 409],
  ['RELATION_EXISTS', 409],
  ['PUBLIC_ROLE_EXISTS', 409],
  ['ROLE_IN_USE', 409],
  ['SCHEMA_METADATA_DRIFT', 409],
  ['INVALID_QUERY', 400],
  ['INVALID_PAYLOAD', 400],
  ['INVALID_PASSWORD', 400],
  ['INVALID_ROLE', 400],
  ['INVALID_PERMISSION', 400],
  ['INVALID_SCHEMA_PAYLOAD', 400],
  ['INVALID_ON_DELETE', 400],
  ['UNSUPPORTED_SCHEMA_UPDATE', 400],
  ['UNSUPPORTED_FIELD_TYPE', 400],
  ['UNSUPPORTED_FIELD_DEFAULT', 400],
  ['UNSUPPORTED_PRIMARY_KEY', 400],
  ['UNSUPPORTED_RELATION_TARGET', 400],
  ['RELATION_TYPE_MISMATCH', 400],
  ['DESTRUCTIVE_OPERATION_REQUIRED', 400],
  ['REQUIRED_FIELD_MISSING', 400],
  ['FIELD_READ_ONLY', 400],
  ['FILTER_REQUIRED', 400],
  ['PERMISSION_VALIDATION_NOT_READY', 400],
  ['DATABASE_MIGRATION_REQUIRED', 503],
]);

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
    const status = statusForError(error);

    if (status >= 500) {
      logger.error?.('YunCMS API request failed', {
        requestId: req.id,
        code: error?.code,
        error,
      });
    }

    res.status(status).json(errorBody(error, req.id));
  };
}
