import { requireAccountability } from './accountability.js';

export function createRequestContext({
  accountability,
  services,
  database,
  schema = null,
  logger = console,
  env = {},
  emitter = null,
  storage = null,
  permissionCache = new Map(),
  requestId = null,
} = {}) {
  requireAccountability(accountability);

  if (!services) throw new Error('Service registry is required');
  if (!database) throw new Error('Database handle is required');
  if (!(permissionCache instanceof Map)) throw new Error('Permission cache must be a Map');

  return Object.freeze({
    accountability,
    services,
    database,
    schema,
    logger,
    env,
    emitter,
    storage,
    permissionCache,
    requestId,
  });
}
