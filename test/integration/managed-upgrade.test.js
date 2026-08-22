import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  applyMigrations,
  closeDatabasePool,
  createDatabasePool,
  loadConfig,
} from '@yunsoft/yuncms-core';
import { resetDatabaseObjects } from '../../packages/cli/src/database-reset.js';
import {
  createProjectBackup,
  restoreProjectBackup,
} from '../../packages/cli/src/project-backup.js';

const MYSQL_ENABLED = process.env.YUNCMS_TEST_MYSQL === '1';
const UPGRADE_ENABLED = process.env.YUNCMS_TEST_UPGRADE === '1';
const DESTRUCTIVE = process.env.YUNCMS_TEST_DB_ALLOW_DESTRUCTIVE === '1';

function requireDisposableDatabase(databaseName) {
  if (!DESTRUCTIVE) {
    throw new Error('YUNCMS_TEST_DB_ALLOW_DESTRUCTIVE=1 is required for managed-upgrade integration tests');
  }
  if (!/(test|ci|dev)/i.test(databaseName)) {
    throw new Error(`Managed-upgrade DB name must contain test, ci or dev: ${databaseName}`);
  }
}

function baseUpgradeEnv() {
  const database = process.env.YUNCMS_UPGRADE_TEST_DB_DATABASE || process.env.DB_DATABASE;
  if (!database) throw new Error('YUNCMS_UPGRADE_TEST_DB_DATABASE or DB_DATABASE is required');
  requireDisposableDatabase(database);
  return {
    ...process.env,
    DB_DATABASE: database,
    FILES_LOCAL_ROOT: '.yuncms/uploads',
    S3_BUCKET: '',
  };
}

async function tableExists(pool, database, table) {
  const [rows] = await pool.query(
    `SELECT COUNT(*) AS count
     FROM information_schema.tables
     WHERE table_schema = ? AND table_name = ?`,
    [database, table],
  );
  return Number(rows[0]?.count ?? 0) === 1;
}

test('real MySQL partial DDL failure is journaled and fails closed on retry', {
  skip: !MYSQL_ENABLED,
  timeout: 45_000,
}, async () => {
  const env = baseUpgradeEnv();
  const config = loadConfig(env);
  const pool = createDatabasePool(config.database);
  const suffix = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
  const migrationId = `integration-partial-ddl-${suffix}`;
  const table = `it_partial_${suffix}`.replace(/[^a-zA-Z0-9_]/g, '_');
  const migration = {
    id: migrationId,
    statements: [
      `CREATE TABLE \`${table}\` (id INT NOT NULL PRIMARY KEY) ENGINE=InnoDB`,
      `ALTER TABLE \`${table}\` ADD COLUMN id INT NULL`,
    ],
  };

  try {
    await pool.query('DELETE FROM yuncms_schema_migration_attempts WHERE migration_id = ?', [migrationId]).catch(() => {});
    await pool.query('DELETE FROM yuncms_schema_migrations WHERE id = ?', [migrationId]).catch(() => {});
    await pool.query(`DROP TABLE IF EXISTS \`${table}\``);

    await assert.rejects(
      applyMigrations(pool, [migration]),
      (error) => error.migrationId === migrationId,
    );

    assert.equal(await tableExists(pool, config.database.database, table), true);
    const [attemptRows] = await pool.query(
      `SELECT status, statement_index, error_code, error_message
       FROM yuncms_schema_migration_attempts
       WHERE migration_id = ?`,
      [migrationId],
    );
    assert.equal(attemptRows.length, 1);
    assert.equal(attemptRows[0].status, 'failed');
    assert.equal(Number(attemptRows[0].statement_index), 1);
    assert.ok(attemptRows[0].error_message);

    await assert.rejects(
      applyMigrations(pool, [migration]),
      (error) => error.code === 'DATABASE_MIGRATION_RECOVERY_REQUIRED'
        && error.migrationAttempts.some((attempt) => attempt.migration_id === migrationId),
    );
  } finally {
    await pool.query('DELETE FROM yuncms_schema_migration_attempts WHERE migration_id = ?', [migrationId]).catch(() => {});
    await pool.query('DELETE FROM yuncms_schema_migrations WHERE id = ?', [migrationId]).catch(() => {});
    await pool.query(`DROP TABLE IF EXISTS \`${table}\``).catch(() => {});
    await closeDatabasePool(pool);
  }
});

test('real mysqldump backup and destructive restore reproduce exact DB and local project snapshot', {
  skip: !(MYSQL_ENABLED && UPGRADE_ENABLED),
  timeout: 120_000,
}, async () => {
  const env = baseUpgradeEnv();
  const config = loadConfig(env);
  const cwd = await mkdtemp(join(tmpdir(), 'yuncms-managed-upgrade-it-'));
  let pool = createDatabasePool(config.database);
  let backupPath = null;

  try {
    await resetDatabaseObjects({ config: config.database });
    await closeDatabasePool(pool);
    pool = createDatabasePool(config.database);

    await pool.query(`
      CREATE TABLE upgrade_fixture (
        id INT NOT NULL PRIMARY KEY,
        value VARCHAR(255) NOT NULL
      ) ENGINE=InnoDB
    `);
    await pool.query('INSERT INTO upgrade_fixture (id, value) VALUES (1, ?)', ['before-update']);

    await mkdir(join(cwd, '.yuncms', 'uploads'), { recursive: true });
    await mkdir(join(cwd, 'extensions'), { recursive: true });
    await writeFile(join(cwd, '.env'), 'DB_DATABASE="snapshot-source"\nSNAPSHOT="before"\n');
    await writeFile(join(cwd, 'package.json'), '{"dependencies":{"@yunsoft/yuncms":"0.1.0"}}\n');
    await writeFile(join(cwd, 'package-lock.json'), '{"lockfileVersion":3,"packages":{}}\n');
    await writeFile(join(cwd, '.yuncms', 'uploads', 'asset.txt'), 'before-file\n');
    await writeFile(join(cwd, 'extensions', 'fixture.js'), 'export const state = "before";\n');

    const backup = await createProjectBackup({
      cwd,
      env,
      output: { log() {}, warn() {} },
    });
    backupPath = backup.backupPath;
    assert.ok(backup.manifest.database.verifiedDecompressedBytes > 0);
    assert.equal(backup.manifest.s3.objectsBackedUp, false);
    const manifestText = await readFile(join(backupPath, 'manifest.json'), 'utf8');
    assert.equal(manifestText.includes(String(env.DB_PASSWORD ?? '')), env.DB_PASSWORD ? false : manifestText.includes(''));
    if (env.S3_SECRET_ACCESS_KEY) assert.equal(manifestText.includes(env.S3_SECRET_ACCESS_KEY), false);

    await pool.query('UPDATE upgrade_fixture SET value = ? WHERE id = 1', ['after-update']);
    await pool.query('CREATE TABLE upgrade_extra (id INT NOT NULL PRIMARY KEY) ENGINE=InnoDB');
    await pool.query('CREATE VIEW upgrade_extra_view AS SELECT id FROM upgrade_extra');
    await writeFile(join(cwd, '.env'), 'DB_DATABASE="mutated"\nSNAPSHOT="after"\n');
    await writeFile(join(cwd, 'package.json'), '{"dependencies":{"@yunsoft/yuncms":"9.9.9"}}\n');
    await writeFile(join(cwd, '.yuncms', 'uploads', 'asset.txt'), 'after-file\n');
    await writeFile(join(cwd, 'extensions', 'fixture.js'), 'export const state = "after";\n');

    await closeDatabasePool(pool);
    pool = null;

    await restoreProjectBackup({
      backupPath,
      cwd,
      env,
      output: { log() {}, warn() {} },
    });

    pool = createDatabasePool(config.database);
    const [fixtureRows] = await pool.query('SELECT id, value FROM upgrade_fixture ORDER BY id');
    assert.deepEqual(fixtureRows, [{ id: 1, value: 'before-update' }]);
    assert.equal(await tableExists(pool, config.database.database, 'upgrade_extra'), false);
    assert.equal(await tableExists(pool, config.database.database, 'upgrade_extra_view'), false);

    assert.equal(await readFile(join(cwd, '.yuncms', 'uploads', 'asset.txt'), 'utf8'), 'before-file\n');
    assert.equal(await readFile(join(cwd, 'extensions', 'fixture.js'), 'utf8'), 'export const state = "before";\n');
    assert.match(await readFile(join(cwd, 'package.json'), 'utf8'), /0\.1\.0/);
    assert.equal(await readFile(join(cwd, '.env'), 'utf8'), 'DB_DATABASE="snapshot-source"\nSNAPSHOT="before"\n');
  } finally {
    if (pool) await closeDatabasePool(pool).catch(() => {});
    await resetDatabaseObjects({ config: config.database }).catch(() => {});
    await rm(cwd, { recursive: true, force: true });
    void backupPath;
  }
});
