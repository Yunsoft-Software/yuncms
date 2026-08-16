const MYSQL_ERROR_CODES = {
  ER_DUP_ENTRY: 'DUPLICATE_KEY',
  ER_NO_REFERENCED_ROW_2: 'FOREIGN_KEY_MISSING',
  ER_ROW_IS_REFERENCED_2: 'FOREIGN_KEY_RESTRICTED',
  ER_LOCK_DEADLOCK: 'DEADLOCK',
  ER_LOCK_WAIT_TIMEOUT: 'LOCK_WAIT_TIMEOUT',
  PROTOCOL_CONNECTION_LOST: 'CONNECTION_LOST',
  ECONNREFUSED: 'CONNECTION_REFUSED',
};

export class YunCmsDatabaseError extends Error {
  constructor(code, message, options = {}) {
    super(message, { cause: options.cause });
    this.name = 'YunCmsDatabaseError';
    this.code = code;
    this.mysqlCode = options.mysqlCode ?? null;
    this.errno = options.errno ?? null;
  }
}

export function normalizeDatabaseError(error) {
  if (error instanceof YunCmsDatabaseError) return error;

  const mappedCode = MYSQL_ERROR_CODES[error?.code] ?? 'DATABASE_ERROR';
  return new YunCmsDatabaseError(mappedCode, error?.message ?? 'Database operation failed', {
    cause: error,
    mysqlCode: error?.code,
    errno: error?.errno,
  });
}

export function isRetryableDatabaseError(error) {
  const code = error?.code;
  return code === 'ER_LOCK_DEADLOCK' || code === 'ER_LOCK_WAIT_TIMEOUT' || code === 'DEADLOCK' || code === 'LOCK_WAIT_TIMEOUT';
}
