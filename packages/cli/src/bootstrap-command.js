import {
  bootstrapDatabase,
  closeDatabasePool,
  createDatabasePool,
  loadConfig,
  pingDatabase,
} from '@yuncms/core';

export async function runBootstrapCommand({ env = process.env, output = console } = {}) {
  const config = loadConfig(env);
  const pool = createDatabasePool(config.database);

  try {
    const connected = await pingDatabase(pool);
    if (!connected) {
      const error = new Error('MySQL connection check returned an unexpected result');
      error.code = 'DATABASE_UNAVAILABLE';
      throw error;
    }

    const result = await bootstrapDatabase(pool);
    output.log?.(
      result.newlyApplied.length > 0
        ? `YunCMS bootstrap applied: ${result.newlyApplied.join(', ')}`
        : 'YunCMS database is already bootstrapped',
    );
    output.log?.(`Schema version: ${result.schemaVersion}`);
    return result;
  } finally {
    await closeDatabasePool(pool);
  }
}
