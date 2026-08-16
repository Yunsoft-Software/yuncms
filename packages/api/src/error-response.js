const STATUS_BY_CODE = new Map([
  ['INVALID_CREDENTIALS', 401],
  ['UNAUTHORIZED', 401],
  ['FORBIDDEN', 403],
  ['FORBIDDEN_FIELD', 403],
  ['COLLECTION_NOT_FOUND', 404],
  ['FIELD_NOT_FOUND', 404],
  ['RELATION_NOT_FOUND', 404],
  ['USER_NOT_FOUND', 404],
  ['ROLE_NOT_FOUND', 404],
  ['NOT_FOUND', 404],
  ['INVALID_QUERY', 400],
  ['INVALID_PAYLOAD', 400],
  ['INVALID_PASSWORD', 400],
  ['REQUIRED_FIELD_MISSING', 400],
  ['FIELD_READ_ONLY', 400],
  ['FILTER_REQUIRED', 400],
  ['INVALID_PERMISSION', 400],
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
