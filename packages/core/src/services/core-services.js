import { ApiTokensService } from './api-tokens-service.js';
import { AuditService } from './audit-service.js';
import { AuthService } from './auth-service.js';
import { AuthTokensService } from './auth-tokens-service.js';
import { CollectionsService } from './collections-service.js';
import { FieldsService } from './fields-service.js';
import { FileReconciliationService } from './file-reconciliation-service.js';
import { FilesService } from './files-service.js';
import { ItemsService } from './items-service.js';
import { PermissionsService } from './permissions-service.js';
import { RelationsService } from './relations-service.js';
import { RolesService } from './roles-service.js';
import { StudioSettingsService } from './studio-settings-service.js';
import { UsersService } from './users-service.js';
import { createServiceRegistry } from './service-registry.js';

export function createCoreServiceRegistry() {
  return createServiceRegistry({
    AuthService,
    AuthTokensService,
    ApiTokensService,
    AuditService,
    ItemsService,
    CollectionsService,
    FieldsService,
    RelationsService,
    UsersService,
    RolesService,
    PermissionsService,
    FilesService,
    FileReconciliationService,
    StudioSettingsService,
  });
}
