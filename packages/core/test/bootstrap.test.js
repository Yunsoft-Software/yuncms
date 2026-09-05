import test from 'node:test';
import assert from 'node:assert/strict';

import { validateMigration, applyMigrations, assertMigrationsApplied } from '../src/migrations.js';
import { withAdvisoryLock } from '../src/advisory-lock.js';
import { CORE_MIGRATIONS, REQUIRED_CORE_MIGRATION_IDS } from '../src/bootstrap.js';

function createMigrationDatabase({ applied = [], attempts = [], failOnSql = null } = {}) {
  const journal = new Set(applied);
  const attemptJournal = new Map(attempts.map((attempt) => [attempt.migration_id, { ...attempt }]));
  const statements = [];

  return {
    statements,
    attemptJournal,
    async query(sql, params = []) {
      const normalized = sql.replace(/\s+/g, ' ').trim();
      statements.push({ sql: normalized, params });

      if (normalized.startsWith('CREATE TABLE IF NOT EXISTS yuncms_schema_migrations')) return [{}, []];
      if (normalized.startsWith('CREATE TABLE IF NOT EXISTS yuncms_schema_migration_attempts')) return [{}, []];
      if (normalized.startsWith('SELECT id FROM yuncms_schema_migrations')) {
        return [[...journal].sort().map((id) => ({ id })), []];
      }
      if (normalized.startsWith('SELECT migration_id, status, statement_index')) {
        return [[...attemptJournal.values()].map((attempt) => ({ ...attempt })), []];
      }
      if (normalized.startsWith('INSERT INTO yuncms_schema_migration_attempts')) {
        attemptJournal.set(params[0], {
          migration_id: params[0],
          status: 'applying',
          statement_index: 0,
          started_at: new Date(),
          finished_at: null,
          error_code: null,
          error_message: null,
        });
        return [{ affectedRows: 1 }, []];
      }
      if (normalized.startsWith('UPDATE yuncms_schema_migration_attempts SET statement_index')) {
        const attempt = attemptJournal.get(params[1]);
        attempt.statement_index = params[0];
        return [{ affectedRows: 1 }, []];
      }
      if (normalized.startsWith("UPDATE yuncms_schema_migration_attempts SET status = 'applied'")) {
        const attempt = attemptJournal.get(params[0]);
        attempt.status = 'applied';
        attempt.finished_at = new Date();
        attempt.error_code = null;
        attempt.error_message = null;
        return [{ affectedRows: 1 }, []];
      }
      if (normalized.startsWith("UPDATE yuncms_schema_migration_attempts SET status = 'failed'")) {
        const attempt = attemptJournal.get(params[2]);
        attempt.status = 'failed';
        attempt.finished_at = new Date();
        attempt.error_code = params[0];
        attempt.error_message = params[1];
        return [{ affectedRows: 1 }, []];
      }
      if (normalized.startsWith('INSERT INTO yuncms_schema_migrations')) {
        journal.add(params[0]);
        return [{ affectedRows: 1 }, []];
      }
      if (failOnSql && normalized === failOnSql) {
        const error = new Error('simulated DDL failure');
        error.code = 'ER_SIMULATED_DDL';
        throw error;
      }
      return [{ affectedRows: 0 }, []];
    },
  };
}

test('migration validation rejects empty migrations', () => {
  assert.throws(() => validateMigration({ id: 'bad', statements: [] }), /must contain statements/);
});

test('migration runner journals only unapplied migrations', async () => {
  const database = createMigrationDatabase({ applied: ['0001'] });
  const result = await applyMigrations(database, [
    { id: '0001', statements: ['SELECT 1'] },
    { id: '0002', statements: ['CREATE TABLE example (id INT)'] },
  ]);

  assert.deepEqual(result.newlyApplied, ['0002']);
  assert.deepEqual(result.applied, ['0001', '0002']);
  assert.equal(database.statements.some(({ sql }) => sql === 'SELECT 1'), false);
  assert.equal(database.statements.some(({ sql }) => sql.startsWith('CREATE TABLE example')), true);
  assert.equal(database.attemptJournal.get('0002').status, 'applied');
  assert.equal(database.attemptJournal.get('0002').statement_index, 1);
});

test('migration runner records a failed statement and refuses a blind retry', async () => {
  const migration = {
    id: '0002',
    statements: ['ALTER TABLE example ADD COLUMN first INT', 'ALTER TABLE example ADD COLUMN second INT'],
  };
  const database = createMigrationDatabase({ failOnSql: migration.statements[1] });

  await assert.rejects(
    applyMigrations(database, [migration]),
    (error) => error.code === 'ER_SIMULATED_DDL' && error.migrationId === '0002',
  );

  const attempt = database.attemptJournal.get('0002');
  assert.equal(attempt.status, 'failed');
  assert.equal(attempt.statement_index, 1);
  assert.equal(attempt.error_code, 'ER_SIMULATED_DDL');

  const firstStatementRunsBeforeRetry = database.statements.filter(
    ({ sql }) => sql === migration.statements[0],
  ).length;

  await assert.rejects(
    applyMigrations(database, [migration]),
    (error) => error.code === 'DATABASE_MIGRATION_RECOVERY_REQUIRED'
      && error.migrationAttempts[0].migration_id === '0002',
  );

  assert.equal(
    database.statements.filter(({ sql }) => sql === migration.statements[0]).length,
    firstStatementRunsBeforeRetry,
  );
});

test('compatibility check fails closed when migrations are missing', async () => {
  const database = createMigrationDatabase({ applied: ['0001'] });

  await assert.rejects(
    assertMigrationsApplied(database, ['0001', '0002']),
    (error) => error.code === 'DATABASE_MIGRATION_REQUIRED' && error.missingMigrations[0] === '0002',
  );
});

test('compatibility check blocks startup when any unapplied migration attempt is incomplete', async () => {
  const database = createMigrationDatabase({
    applied: ['0001'],
    attempts: [{
      migration_id: 'future-partial-migration',
      status: 'failed',
      statement_index: 1,
      started_at: new Date(),
      finished_at: new Date(),
      error_code: 'ER_DDL_FAILED',
      error_message: 'partial DDL',
    }],
  });

  await assert.rejects(
    assertMigrationsApplied(database, ['0001']),
    (error) => error.code === 'DATABASE_MIGRATION_RECOVERY_REQUIRED'
      && error.migrationAttempts[0].migration_id === 'future-partial-migration',
  );
});

test('compatibility remains readable for pre-attempt-journal databases', async () => {
  const database = createMigrationDatabase({ applied: ['0001'] });
  const originalQuery = database.query.bind(database);
  database.query = async (sql, params) => {
    if (sql.replace(/\s+/g, ' ').trim().startsWith('SELECT migration_id, status, statement_index')) {
      const error = new Error('attempt journal missing');
      error.code = 'ER_NO_SUCH_TABLE';
      throw error;
    }
    return originalQuery(sql, params);
  };

  await assert.doesNotReject(assertMigrationsApplied(database, ['0001']));
});

test('system schema quotes the MySQL reserved system column', () => {
  const systemSchema = CORE_MIGRATIONS.find(({ id }) => id === '0001-system-schema');
  const collectionsTable = systemSchema.statements.find((statement) => (
    statement.includes('CREATE TABLE IF NOT EXISTS yuncms_collections')
  ));

  assert.match(collectionsTable, /`system` TINYINT\(1\)/);
});

test('default public role migration is part of the required compatibility gate', () => {
  const migration = CORE_MIGRATIONS.find(({ id }) => id === '0005-default-public-role');
  assert.ok(migration);
  assert.ok(REQUIRED_CORE_MIGRATION_IDS.includes('0005-default-public-role'));
  assert.match(migration.statements[0], /WHERE NOT EXISTS .*public = 1/s);
  assert.doesNotMatch(migration.statements[0], /yuncms_permissions/);
});

test('Studio settings migration creates one safe branding/settings row', () => {
  const migration = CORE_MIGRATIONS.find(({ id }) => id === '0006-studio-settings');
  assert.ok(migration);
  assert.ok(REQUIRED_CORE_MIGRATION_IDS.includes('0006-studio-settings'));
  assert.match(migration.statements[0], /CREATE TABLE IF NOT EXISTS yuncms_studio_settings/);
  assert.match(migration.statements[0], /theme IN \('system', 'light', 'dark'\)/);
  assert.match(migration.statements[0], /default_locale IN \('en', 'tr'\)/);
  assert.match(migration.statements[1], /https:\/\/yunsoft\.com\/light-logo\.png/);
});

test('system permission resources migration is required and registers only bounded resources', () => {
  const migration = CORE_MIGRATIONS.find(({ id }) => id === '0007-system-permission-resources');
  assert.ok(migration);
  assert.ok(REQUIRED_CORE_MIGRATION_IDS.includes('0007-system-permission-resources'));
  const source = migration.statements.join('\n');
  assert.match(source, /'yuncms_users'/);
  assert.match(source, /'yuncms_files'/);
  assert.match(source, /'yuncms_roles'/);
  assert.match(source, /'permissionManaged', TRUE/);
  assert.match(source, /'allowedActions', JSON_ARRAY\('read'/);
  assert.doesNotMatch(source, /'yuncms_permissions'.*permissionManaged/s);
  assert.doesNotMatch(source, /password_hash/);
});

test('file-backed Studio logo migration remains required', () => {
  const migration = CORE_MIGRATIONS.find(({ id }) => id === '0008-studio-logo-file');
  assert.ok(migration);
  assert.ok(REQUIRED_CORE_MIGRATION_IDS.includes('0008-studio-logo-file'));
  const source = migration.statements.join('\n');
  assert.match(source, /ADD COLUMN logo_file CHAR\(36\) NULL/);
  assert.match(source, /REFERENCES yuncms_files \(id\) ON DELETE SET NULL/);
});

test('schema display-name migration backfills collection and field labels', () => {
  const migration = CORE_MIGRATIONS.find(({ id }) => id === '0009-schema-display-names');
  assert.ok(migration);
  assert.ok(REQUIRED_CORE_MIGRATION_IDS.includes('0009-schema-display-names'));
  const source = migration.statements.join('\n');
  assert.match(source, /yuncms_collections[\s\S]*ADD COLUMN name VARCHAR\(255\)/);
  assert.match(source, /SET name = collection/);
  assert.match(source, /yuncms_fields[\s\S]*ADD COLUMN name VARCHAR\(255\)/);
  assert.match(source, /SET name = field/);
});

test('file-backed Studio favicon migration remains required', () => {
  const migration = CORE_MIGRATIONS.find(({ id }) => id === '0010-studio-favicon-file');
  assert.ok(migration);
  assert.ok(REQUIRED_CORE_MIGRATION_IDS.includes('0010-studio-favicon-file'));
  const source = migration.statements.join('\n');
  assert.match(source, /ADD COLUMN favicon_file CHAR\(36\) NULL/);
  assert.match(source, /REFERENCES yuncms_files \(id\) ON DELETE SET NULL/);
});

test('role permission actions migration remains required', () => {
  const migration = CORE_MIGRATIONS.find(({ id }) => id === '0011-role-permission-actions');
  assert.ok(migration);
  assert.ok(REQUIRED_CORE_MIGRATION_IDS.includes('0011-role-permission-actions'));
  const source = migration.statements.join('\n');
  assert.match(source, /collection = 'yuncms_roles'/);
  assert.match(source, /JSON_ARRAY\('read', 'create', 'update', 'delete'\)/);
});

test('Files read-filter migration remains required', () => {
  const migration = CORE_MIGRATIONS.find(({ id }) => id === '0012-files-read-filters');
  assert.ok(migration);
  assert.ok(REQUIRED_CORE_MIGRATION_IDS.includes('0012-files-read-filters'));
  const source = migration.statements.join('\n');
  assert.match(source, /collection = 'yuncms_files'/);
  assert.match(source, /permissionMode/);
  assert.match(source, /filter-read/);
});

test('external auth foundation migration remains a required compatibility gate', () => {
  const migration = CORE_MIGRATIONS.find(({ id }) => id === '0013-external-auth-foundation');
  assert.ok(migration);
  assert.ok(REQUIRED_CORE_MIGRATION_IDS.includes('0013-external-auth-foundation'));
  const source = migration.statements.join('\n');
  assert.match(source, /CREATE TABLE IF NOT EXISTS yuncms_auth_identities/);
  assert.match(source, /UNIQUE KEY uq_yuncms_auth_identity_provider_subject \(provider, subject\)/);
  assert.match(source, /CREATE TABLE IF NOT EXISTS yuncms_auth_transactions/);
  assert.match(source, /UNIQUE KEY uq_yuncms_auth_transaction_state \(state_hash\)/);
});

test('AI, navigation, MCP and registration settings extend the required compatibility gate', () => {
  const aiSettings = CORE_MIGRATIONS.find(({ id }) => id === '0014-ai-settings');
  const navigationGroups = CORE_MIGRATIONS.find(({ id }) => id === '0015-navigation-groups');
  const navigationGroupCollapse = CORE_MIGRATIONS.find(({ id }) => id === '0016-navigation-group-collapse');
  const mcpSettings = CORE_MIGRATIONS.find(({ id }) => id === '0017-mcp-settings');
  const publicRegistrationSettings = CORE_MIGRATIONS.find(({ id }) => id === '0018-public-registration-settings');
  const publicRegistrationEmailVerification = CORE_MIGRATIONS.find(({ id }) => id === '0019-public-registration-email-verification');
  assert.ok(aiSettings);
  assert.ok(navigationGroups);
  assert.ok(navigationGroupCollapse);
  assert.ok(mcpSettings);
  assert.ok(publicRegistrationSettings);
  assert.ok(publicRegistrationEmailVerification);
  assert.ok(REQUIRED_CORE_MIGRATION_IDS.includes('0014-ai-settings'));
  assert.ok(REQUIRED_CORE_MIGRATION_IDS.includes('0015-navigation-groups'));
  assert.ok(REQUIRED_CORE_MIGRATION_IDS.includes('0016-navigation-group-collapse'));
  assert.ok(REQUIRED_CORE_MIGRATION_IDS.includes('0017-mcp-settings'));
  assert.ok(REQUIRED_CORE_MIGRATION_IDS.includes('0018-public-registration-settings'));
  assert.ok(REQUIRED_CORE_MIGRATION_IDS.includes('0019-public-registration-email-verification'));
  assert.match(aiSettings.statements.join('\n'), /CREATE TABLE yuncms_ai_settings/);
  assert.match(navigationGroups.statements.join('\n'), /CREATE TABLE yuncms_navigation_groups/);
  assert.match(navigationGroupCollapse.statements.join('\n'), /ADD COLUMN collapse VARCHAR\(16\)/);
  assert.match(mcpSettings.statements.join('\n'), /CREATE TABLE yuncms_mcp_settings/);
  assert.match(mcpSettings.statements.join('\n'), /allowed_origins JSON NOT NULL/);
  assert.match(mcpSettings.statements.join('\n'), /allowed_hosts JSON NOT NULL/);
  assert.match(publicRegistrationSettings.statements.join('\n'), /public_registration_enabled TINYINT\(1\)/);
  assert.match(publicRegistrationSettings.statements.join('\n'), /public_registration_role CHAR\(36\)/);
  assert.match(publicRegistrationEmailVerification.statements.join('\n'), /public_registration_require_email_verification TINYINT\(1\)/);
});

test('expanded Studio locale constraint is a required atomic upgrade', () => {
  const migration = CORE_MIGRATIONS.find(({ id }) => id === '0020-studio-locales');
  assert.ok(migration);
  assert.ok(REQUIRED_CORE_MIGRATION_IDS.includes('0020-studio-locales'));
  assert.equal(migration.statements.length, 1);
  assert.match(migration.statements[0], /DROP CHECK chk_yuncms_studio_settings_locale/);
  assert.match(
    migration.statements[0],
    /default_locale IN \('en', 'tr', 'es', 'de', 'fr', 'pt-BR', 'ja', 'zh-CN'\)/,
  );
  assert.equal(CORE_MIGRATIONS.at(-1).id, '0020-studio-locales');
});

test('advisory lock uses one connection and always releases it', async () => {
  const calls = [];
  let released = false;
  const connection = {
    async query(sql, params) {
      calls.push({ sql, params });
      if (sql.startsWith('SELECT GET_LOCK')) return [[{ acquired: 1 }], []];
      if (sql.startsWith('SELECT RELEASE_LOCK')) return [[{ released: 1 }], []];
      return [[], []];
    },
    release() {
      released = true;
    },
  };
  const pool = { async getConnection() { return connection; } };

  const result = await withAdvisoryLock(pool, 'yuncms:test', async (lockedConnection) => {
    assert.equal(lockedConnection, connection);
    return 'ok';
  });

  assert.equal(result, 'ok');
  assert.equal(calls[0].params[0], 'yuncms:test');
  assert.equal(calls.at(-1).sql, 'SELECT RELEASE_LOCK(?) AS released');
  assert.equal(released, true);
});
