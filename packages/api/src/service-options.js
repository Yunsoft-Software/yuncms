import { activeAdvisoryLockConnection } from '@yunsoft/yuncms-core';

function isDatabaseHandle(value) {
  return Boolean(
    value
    && typeof value === 'object'
    && typeof value.query === 'function'
    && !('context' in value)
    && !('headers' in value),
  );
}

function isServiceOptionsOverrideObject(value) {
  if (!value || typeof value !== 'object') return false;
  if ('context' in value || 'headers' in value || 'method' in value || 'url' in value || 'id' in value) return false;
  return (
    'database' in value
    || 'schema' in value
    || 'permissionCache' in value
    || 'requestId' in value
    || 'authConfig' in value
    || 'logger' in value
    || 'emitter' in value
    || 'storage' in value
  );
}

export function resolveServiceOptionsInput(first = null, second = null) {
  if (isDatabaseHandle(first)) {
    const extra = isDatabaseHandle(second) ? { database: second } : (second && typeof second === 'object' ? second : {});
    return { req: null, overrides: { database: first, ...extra } };
  }
  if (isServiceOptionsOverrideObject(first)) {
    const extra = isDatabaseHandle(second) ? { database: second } : (second && typeof second === 'object' ? second : {});
    return { req: null, overrides: { ...first, ...extra } };
  }
  const extra = isDatabaseHandle(second) ? { database: second } : (second && typeof second === 'object' ? second : {});
  return { req: first, overrides: extra };
}

export function serviceOptionsFromRequest(req, overrides = null) {
  if (!req?.context) throw new Error('Request context is required');
  const { overrides: extra } = resolveServiceOptionsInput(req, overrides);
  const database = extra.database ?? activeAdvisoryLockConnection(req.context.database);

  return {
    accountability: req.accountability,
    database,
    schema: req.context.schema,
    logger: req.context.logger,
    emitter: req.context.emitter,
    storage: req.context.storage,
    permissionCache: req.context.permissionCache,
    requestId: req.id,
    authConfig: req.context.env?.auth ?? null,
    ...extra,
    database,
  };
}
