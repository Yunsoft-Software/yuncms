const JOURNAL_TABLE = 'yuncms_schema_migrations';
const ATTEMPT_TABLE = 'yuncms_schema_migration_attempts';

function truncateErrorMessage(value, maxLength = 1000) {
  const message = String(value ?? 'Migration failed');
  return message.length > maxLength ? message.slice(0, maxLength) : message;
}

export async function ensureMigrationJournal(database) {
  await database.query(`
    CREATE TABLE IF NOT EXISTS ${JOURNAL_TABLE} (
      id VARCHAR(191) NOT NULL PRIMARY KEY,
      applied_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  await database.query(`
    CREATE TABLE IF NOT EXISTS ${ATTEMPT_TABLE} (
      migration_id VARCHAR(191) NOT NULL PRIMARY KEY,
      status VARCHAR(16) NOT NULL,
      statement_index INT UNSIGNED NOT NULL DEFAULT 0,
      started_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      finished_at DATETIME(3) NULL,
      error_code VARCHAR(128) NULL,
      error_message VARCHAR(1000) NULL,
      CONSTRAINT chk_yuncms_schema_migration_attempt_status
        CHECK (status IN ('applying', 'applied', 'failed'))
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
}

export async function readAppliedMigrations(database) {
  const [rows] = await database.query(`SELECT id FROM ${JOURNAL_TABLE} ORDER BY id ASC`);
  return new Set(rows.map((row) => row.id));
}

export async function readMigrationAttempts(database) {
  const [rows] = await database.query(
    `SELECT migration_id, status, statement_index, started_at, finished_at, error_code, error_message
     FROM ${ATTEMPT_TABLE}
     ORDER BY started_at ASC, migration_id ASC`,
  );
  return rows;
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

function migrationRecoveryError(attempts) {
  const ids = attempts.map((attempt) => attempt.migration_id);
  const error = new Error(
    `Database contains an incomplete migration attempt and must be restored before retrying: ${ids.join(', ')}`,
  );
  error.code = 'DATABASE_MIGRATION_RECOVERY_REQUIRED';
  error.migrationAttempts = attempts.map((attempt) => ({ ...attempt }));
  return error;
}

async function assertNoIncompleteMigrationAttempts(database, applied) {
  const attempts = await readMigrationAttempts(database);
  const inconsistent = attempts.filter((attempt) => !applied.has(attempt.migration_id));
  if (inconsistent.length > 0) throw migrationRecoveryError(inconsistent);
}

async function beginMigrationAttempt(database, migration) {
  await database.query(
    `INSERT INTO ${ATTEMPT_TABLE}
       (migration_id, status, statement_index, started_at, finished_at, error_code, error_message)
     VALUES (?, 'applying', 0, CURRENT_TIMESTAMP(3), NULL, NULL, NULL)`,
    [migration.id],
  );
}

async function advanceMigrationAttempt(database, migrationId, statementIndex) {
  await database.query(
    `UPDATE ${ATTEMPT_TABLE}
     SET statement_index = ?
     WHERE migration_id = ? AND status = 'applying'`,
    [statementIndex, migrationId],
  );
}

async function completeMigrationAttempt(database, migrationId) {
  await database.query(
    `UPDATE ${ATTEMPT_TABLE}
     SET status = 'applied', finished_at = CURRENT_TIMESTAMP(3), error_code = NULL, error_message = NULL
     WHERE migration_id = ?`,
    [migrationId],
  );
}

async function failMigrationAttempt(database, migrationId, error) {
  await database.query(
    `UPDATE ${ATTEMPT_TABLE}
     SET status = 'failed', finished_at = CURRENT_TIMESTAMP(3), error_code = ?, error_message = ?
     WHERE migration_id = ?`,
    [
      error?.code == null ? null : String(error.code).slice(0, 128),
      truncateErrorMessage(error?.message),
      migrationId,
    ],
  );
}

export async function applyMigrations(database, migrations) {
  if (!database) throw new Error('Database handle is required');
  if (!Array.isArray(migrations)) throw new Error('Migrations must be an array');

  await ensureMigrationJournal(database);
  const applied = await readAppliedMigrations(database);
  await assertNoIncompleteMigrationAttempts(database, applied);
  const newlyApplied = [];

  for (const rawMigration of migrations) {
    const migration = validateMigration(rawMigration);
    if (applied.has(migration.id)) continue;

    await beginMigrationAttempt(database, migration);

    try {
      for (let index = 0; index < migration.statements.length; index += 1) {
        await database.query(migration.statements[index]);
        await advanceMigrationAttempt(database, migration.id, index + 1);
      }

      await database.query(`INSERT INTO ${JOURNAL_TABLE} (id) VALUES (?)`, [migration.id]);
      await completeMigrationAttempt(database, migration.id);
    } catch (error) {
      try {
        await failMigrationAttempt(database, migration.id, error);
      } catch {
        // The original migration error remains the source of truth. A stale 'applying'
        // row still fails closed on the next bootstrap and requires restore/recovery.
      }
      error.migrationId ||= migration.id;
      throw error;
    }

    applied.add(migration.id);
    newlyApplied.push(migration.id);
  }

  return {
    applied: [...applied].sort(),
    newlyApplied,
  };
}

export async function assertMigrationsApplied(database, requiredMigrationIds) {
  let applied;

  try {
    applied = await readAppliedMigrations(database);
  } catch (error) {
    if (error?.code === 'ER_NO_SUCH_TABLE') {
      const migrationError = new Error('Database bootstrap is required');
      migrationError.code = 'DATABASE_MIGRATION_REQUIRED';
      migrationError.missingMigrations = [...requiredMigrationIds];
      throw migrationError;
    }
    throw error;
  }

  const missing = requiredMigrationIds.filter((id) => !applied.has(id));

  if (missing.length > 0) {
    const error = new Error(`Database bootstrap is incomplete. Missing migrations: ${missing.join(', ')}`);
    error.code = 'DATABASE_MIGRATION_REQUIRED';
    error.missingMigrations = missing;
    throw error;
  }

  return true;
}
