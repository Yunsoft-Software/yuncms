import { withAdvisoryLock } from './advisory-lock.js';
import { applyMigrations, assertMigrationsApplied } from './migrations.js';
import { systemSchemaMigration } from './migrations/0001-system-schema.js';
import { sessionAccessTokensMigration } from './migrations/0002-session-access-tokens.js';
import { publicRoleConstraintsMigration } from './migrations/0003-public-role-constraints.js';
import { authActionTokensMigration } from './migrations/0004-auth-action-tokens.js';
import { readSchemaVersion } from './schema-version.js';
import { ensurePublicRole } from './setup.js';

export const CORE_MIGRATIONS = Object.freeze([
  systemSchemaMigration,
  sessionAccessTokensMigration,
  publicRoleConstraintsMigration,
  authActionTokensMigration,
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

      return {
        ...migrationResult,
        publicRole: {
          id: publicRole.id,
          name: publicRole.name,
          created: publicRole.created,
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
