import { ApiTokensService } from './api-tokens-service.js';
import { AuditService } from './audit-service.js';
import { AuthService } from './auth-service.js';
import { AuthTokensService } from './auth-tokens-service.js';
import { ExternalAuthService } from './external-auth-service.js';
import { FieldsService } from './fields-service.js';
import { FileReconciliationService } from './file-reconciliation-service.js';
import { FilesService } from './files-service.js';
import { NavigationGroupsService } from './navigation-groups-service.js';
import { PermissionsService } from './permissions-service.js';
import { RelationsService } from './relations-service.js';
import { RolesService } from './roles-service.js';
import { SingletonCollectionsService, SingletonItemsService } from './singleton-services.js';
import { StudioSettingsService } from './studio-settings-service.js';
import { SystemCollectionFieldsService } from './system-collection-fields-service.js';
import { UsersService } from './users-service.js';
import { createServiceRegistry } from './service-registry.js';

export function createCoreServiceRegistry() {
  return createServiceRegistry({
    AuthService,
    AuthTokensService,
    ExternalAuthService,
    ApiTokensService,
    AuditService,
    ItemsService: SingletonItemsService,
    CollectionsService: SingletonCollectionsService,
    FieldsService,
    SystemCollectionFieldsService,
    RelationsService,
    UsersService,
    RolesService,
    PermissionsService,
    FilesService,
    FileReconciliationService,
    StudioSettingsService,
    NavigationGroupsService,
  });
}
