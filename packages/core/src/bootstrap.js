import { withAdvisoryLock } from './advisory-lock.js';
import { applyMigrations, assertMigrationsApplied } from './migrations.js';
import { systemSchemaMigration } from './migrations/0001-system-schema.js';
import { sessionAccessTokensMigration } from './migrations/0002-session-access-tokens.js';
import { publicRoleConstraintsMigration } from './migrations/0003-public-role-constraints.js';
import { authActionTokensMigration } from './migrations/0004-auth-action-tokens.js';
import { defaultPublicRoleMigration } from './migrations/0005-default-public-role.js';
import { studioSettingsMigration } from './migrations/0006-studio-settings.js';
import { systemPermissionResourcesMigration } from './migrations/0007-system-permission-resources.js';
import { studioLogoFileMigration } from './migrations/0008-studio-logo-file.js';
import { schemaDisplayNamesMigration } from './migrations/0009-schema-display-names.js';
import { studioFaviconFileMigration } from './migrations/0010-studio-favicon-file.js';
import { rolePermissionActionsMigration } from './migrations/0011-role-permission-actions.js';
import { filesReadFiltersMigration } from './migrations/0012-files-read-filters.js';
import { externalAuthFoundationMigration } from './migrations/0013-external-auth-foundation.js';
import { aiSettingsMigration } from './migrations/0014-ai-settings.js';
import { navigationGroupsMigration } from './migrations/0015-navigation-groups.js';
import { navigationGroupCollapseMigration } from './migrations/0016-navigation-group-collapse.js';
import { mcpSettingsMigration } from './migrations/0017-mcp-settings.js';
import { publicRegistrationSettingsMigration } from './migrations/0018-public-registration-settings.js';
import { publicRegistrationEmailVerificationMigration } from './migrations/0019-public-registration-email-verification.js';
import { studioLocalesMigration } from './migrations/0020-studio-locales.js';
import { readSchemaVersion } from './schema-version.js';
import { ensurePublicRole } from './setup.js';

export const CORE_MIGRATIONS = Object.freeze([
  systemSchemaMigration,
  sessionAccessTokensMigration,
  publicRoleConstraintsMigration,
  authActionTokensMigration,
  defaultPublicRoleMigration,
  studioSettingsMigration,
  systemPermissionResourcesMigration,
  studioLogoFileMigration,
  schemaDisplayNamesMigration,
  studioFaviconFileMigration,
  rolePermissionActionsMigration,
  filesReadFiltersMigration,
  externalAuthFoundationMigration,
  aiSettingsMigration,
  navigationGroupsMigration,
  navigationGroupCollapseMigration,
  mcpSettingsMigration,
  publicRegistrationSettingsMigration,
  publicRegistrationEmailVerificationMigration,
  studioLocalesMigration,
]);

export const REQUIRED_CORE_MIGRATION_IDS = Object.freeze(
  CORE_MIGRATIONS.map((migration) => migration.id),
);

export async function bootstrapDatabase(pool, { lockTimeoutSeconds = 10 } = {}) {
  return withAdvisoryLock(
    pool,
    'yuncms:bootstrap',
    async (connection) => {
      const migrationResult = await applyMigrations(connection, CORE_MIGRATIONS);
      const publicRole = await ensurePublicRole(connection);
      const schemaVersion = await readSchemaVersion(connection);
      const publicRoleMigrated = migrationResult.newlyApplied.includes(defaultPublicRoleMigration.id);

      return {
        ...migrationResult,
        publicRole: {
          id: publicRole.id,
          name: publicRole.name,
          created: publicRole.created || publicRoleMigrated,
        },
        schemaVersion,
      };
    },
    { timeoutSeconds: lockTimeoutSeconds },
  );
}

export async function assertDatabaseCompatible(pool) {
  await assertMigrationsApplied(pool, REQUIRED_CORE_MIGRATION_IDS);
  await readSchemaVersion(pool);
  return true;
}
