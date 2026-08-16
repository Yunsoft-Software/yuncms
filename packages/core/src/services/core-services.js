import { CollectionsService } from './collections-service.js';
import { FieldsService } from './fields-service.js';
import { RelationsService } from './relations-service.js';
import { createServiceRegistry } from './service-registry.js';

export function createCoreServiceRegistry() {
  return createServiceRegistry({
    CollectionsService,
    FieldsService,
    RelationsService,
  });
}
