import { CollectionsService } from './collections-service.js';
import { FieldsService } from './fields-service.js';
import { ItemsService } from './items-service.js';
import { PermissionsService } from './permissions-service.js';
import { RelationsService } from './relations-service.js';
import { RolesService } from './roles-service.js';
import { createServiceRegistry } from './service-registry.js';

export function createCoreServiceRegistry() {
  return createServiceRegistry({
    ItemsService,
    CollectionsService,
    FieldsService,
    RelationsService,
    RolesService,
    PermissionsService,
  });
}
