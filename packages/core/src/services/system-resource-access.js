import { PermissionsService } from './permissions-service.js';

export async function resolveSystemResourceAccess(service, action, collection) {
  if (service.accountability.admin === true || service.accountability.system === true) {
    return {
      fullAccess: true,
      action,
      collection,
      role: service.accountability.role ?? null,
    };
  }

  const permissions = new PermissionsService({
    accountability: service.accountability,
    database: service.database,
    schema: service.schema,
    emitter: service.emitter,
    logger: service.logger,
    permissionCache: service.permissionCache,
    requestId: service.requestId,
  });
  return permissions.resolve(action, collection);
}
