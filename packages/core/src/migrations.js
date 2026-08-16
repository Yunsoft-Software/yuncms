const JOURNAL_TABLE = 'yuncms_schema_migrations';

export async function ensureMigrationJournal(database) {
  await database.query(`
    CREATE TABLE IF NOT EXISTS ${JOURNAL_TABLE} (
      id VARCHAR(191) NOT NULL PRIMARY KEY,
      applied_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
}

export async function readAppliedMigrations(database) {
  const [rows] = await database.query(`SELECT id FROM ${JOURNAL_TABLE} ORDER BY id ASC`);
  return new Set(rows.map((row) => row.id));
}

export function validateMigration(migration) {
  if (!migration || typeof migration !== 'object') throw new Error('Migration must be an object');
  if (!migration.id || typeof migration.id !== 'string') throw new Error('Migration id is required');
  if (!Array.isArray(migration.statements) || migration.statements.length === 0) {
    throw new Error(`Migration ${migration.id} must contain statements`);
  }
  if (migration.statements.some((statement) => typeof statement !== 'string' || !statement.trim())) {
    throw new Error(`Migration ${migration.id} contains an invalid statement`);
  }
  return migration;
}

export async function applyMigrations(database, migrations) {
  if (!database) throw new Error('Database handle is required');
  if (!Array.isArray(migrations)) throw new Error('Migrations must be an array');

  await ensureMigrationJournal(database);
  const applied = await readAppliedMigrations(database);
  const newlyApplied = [];

  for (const rawMigration of migrations) {
    const migration = validateMigration(rawMigration);
    if (applied.has(migration.id)) continue;

    for (const statement of migration.statements) {
      await database.query(statement);
    }

    await database.query(`INSERT INTO ${JOURNAL_TABLE} (id) VALUES (?)`, [migration.id]);
    applied.add(migration.id);
    newlyApplied.push(migration.id);
  }

  return {
    applied: [...applied].sort(),
    newlyApplied,
  };
}

export async function assertMigrationsApplied(database, requiredMigrationIds) {
  await ensureMigrationJournal(database);
  const applied = await readAppliedMigrations(database);
  const missing = requiredMigrationIds.filter((id) => !applied.has(id));

  if (missing.length > 0) {
    const error = new Error(`Database bootstrap is incomplete. Missing migrations: ${missing.join(', ')}`);
    error.code = 'DATABASE_MIGRATION_REQUIRED';
    error.missingMigrations = missing;
    throw error;
  }

  return true;
}
