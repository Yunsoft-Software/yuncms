import test from 'node:test';
import assert from 'node:assert/strict';

import { validateMigration, applyMigrations, assertMigrationsApplied } from '../src/migrations.js';
import { withAdvisoryLock } from '../src/advisory-lock.js';
import { CORE_MIGRATIONS, REQUIRED_CORE_MIGRATION_IDS } from '../src/bootstrap.js';

function createMigrationDatabase({ applied = [] } = {}) {
  const journal = new Set(applied);
  const statements = [];

  return {
    statements,
    async query(sql, params = []) {
      const normalized = sql.replace(/\s+/g, ' ').trim();
      statements.push({ sql: normalized, params });

      if (normalized.startsWith('CREATE TABLE IF NOT EXISTS yuncms_schema_migrations')) return [{}, []];
      if (normalized.startsWith('SELECT id FROM yuncms_schema_migrations')) {
        return [[...journal].sort().map((id) => ({ id })), []];
      }
      if (normalized.startsWith('INSERT INTO yuncms_schema_migrations')) {
        journal.add(params[0]);
        return [{ affectedRows: 1 }, []];
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
});

test('compatibility check fails closed when migrations are missing', async () => {
  const database = createMigrationDatabase({ applied: ['0001'] });

  await assert.rejects(
    assertMigrationsApplied(database, ['0001', '0002']),
    (error) => error.code === 'DATABASE_MIGRATION_REQUIRED' && error.missingMigrations[0] === '0002',
  );
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

test('Files read-filter migration is the latest compatibility gate', () => {
  const migration = CORE_MIGRATIONS.find(({ id }) => id === '0012-files-read-filters');
  assert.ok(migration);
  assert.ok(REQUIRED_CORE_MIGRATION_IDS.includes('0012-files-read-filters'));
  const source = migration.statements.join('\n');
  assert.match(source, /collection = 'yuncms_files'/);
  assert.match(source, /permissionMode/);
  assert.match(source, /filter-read/);
  assert.equal(CORE_MIGRATIONS.at(-1).id, '0012-files-read-filters');
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
