import { redactAuditValue } from './services/audit-service.js';

const LEVELS = Object.freeze({ debug: 10, info: 20, warn: 30, error: 40 });

function normalizeError(error) {
  if (!(error instanceof Error)) return error;
  return {
    name: error.name,
    code: error.code ?? null,
    message: error.message,
    stack: error.stack,
  };
}

function normalizeMeta(meta) {
  if (meta == null) return {};
  if (meta instanceof Error) return { error: normalizeError(meta) };
  if (typeof meta !== 'object' || Array.isArray(meta)) return { value: meta };

  return Object.fromEntries(
    Object.entries(meta).map(([key, value]) => [
      key,
      value instanceof Error ? normalizeError(value) : value,
    ]),
  );
}

export function createJsonLogger({
  level = 'info',
  output = process.stdout,
  errorOutput = process.stderr,
  now = () => new Date(),
} = {}) {
  const threshold = LEVELS[level] ?? LEVELS.info;

  function write(logLevel, message, meta) {
    if (LEVELS[logLevel] < threshold) return;
    const record = redactAuditValue({
      timestamp: now().toISOString(),
      level: logLevel,
      message: String(message),
      ...normalizeMeta(meta),
    });
    const stream = logLevel === 'error' ? errorOutput : output;
    stream.write(`${JSON.stringify(record)}\n`);
  }

  return Object.freeze({
    debug(message, meta) { write('debug', message, meta); },
    info(message, meta) { write('info', message, meta); },
    warn(message, meta) { write('warn', message, meta); },
    error(message, meta) { write('error', message, meta); },
  });
}

export { LEVELS };
