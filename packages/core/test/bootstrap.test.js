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
