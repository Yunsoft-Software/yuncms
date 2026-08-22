import { requireAccountability } from './accountability.js';
import { isCacheStore } from './cache.js';

export function createRequestContext({
  accountability,
  services,
  database,
  schema = null,
  logger = console,
  env = {},
  emitter = null,
  storage = null,
  permissionCache = null,
  requestId = null,
} = {}) {
  requireAccountability(accountability);

  if (!services) throw new Error('Service registry is required');
  if (!database) throw new Error('Database handle is required');
  if (permissionCache !== null && !isCacheStore(permissionCache)) {
    throw new Error('Permission cache must implement the cache-store contract');
  }

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
