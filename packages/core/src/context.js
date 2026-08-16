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
  requestId = null,
} = {}) {
  requireAccountability(accountability);

  if (!services) throw new Error('Service registry is required');
  if (!database) throw new Error('Database handle is required');

  return Object.freeze({
    accountability,
    services,
    database,
    schema,
    logger,
    env,
    emitter,
    storage,
    requestId,
  });
}
