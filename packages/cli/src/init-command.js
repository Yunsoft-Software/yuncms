import { existsSync } from 'node:fs';
import { join } from 'node:path';

import {
  bootstrapDatabase,
  closeDatabasePool,
  createDatabasePool,
  createInitialAdmin,
  findExistingAdmin,
  loadConfig,
  pingDatabase,
} from '@yunsoft/yuncms-core';

import { writeEnvFile } from './env-file.js';
import { createInteractivePrompts } from './prompts.js';

export async function collectEnvironment(prompts) {
  const DB_HOST = await prompts.line('MySQL host', { defaultValue: '127.0.0.1' });
  const DB_PORT = await prompts.line('MySQL port', { defaultValue: '3306' });
  const DB_DATABASE = await prompts.line('MySQL database', { defaultValue: 'yuncms' });
  const DB_USER = await prompts.line('MySQL user', { defaultValue: 'yuncms' });
  const DB_PASSWORD = await prompts.secret('MySQL password');
  const DB_SSL = await prompts.line('Use MySQL TLS (true/false)', { defaultValue: 'false' });

  return {
    HOST: '127.0.0.1',
    PORT: '3008',
    STUDIO_ORIGIN: 'http://localhost:3008',
    AUTH_PUBLIC_URL: 'http://localhost:3008',
    DB_HOST,
    DB_PORT,
    DB_DATABASE,
    DB_USER,
    DB_PASSWORD,
    DB_CONNECTION_LIMIT: '10',
    DB_SSL,
  };
}

async function collectAdmin(prompts) {
  const email = await prompts.line('Administrator email');
  const password = await prompts.secret('Administrator password');
  const confirmation = await prompts.secret('Confirm administrator password');

  if (password !== confirmation) {
    const error = new Error('Administrator passwords do not match');
    error.code = 'PASSWORD_CONFIRMATION_MISMATCH';
    throw error;
  }

  return { email, password };
}

export async function runInitCommand({
  env = process.env,
  cwd = process.cwd(),
  output = console,
  prompts = createInteractivePrompts(),
} = {}) {
  const envPath = join(cwd, '.env');
  const workingEnv = { ...env };

  if (!existsSync(envPath)) {
    output.log?.('YunCMS setup: database configuration');
    const collected = await collectEnvironment(prompts);
    const config = loadConfig(collected);
    void config;
    await writeEnvFile(envPath, collected);
    Object.assign(workingEnv, collected);
    output.log?.(`Created ${envPath}`);
  } else {
    output.log?.(`Using existing ${envPath}`);
  }

  const config = loadConfig(workingEnv);
  const pool = createDatabasePool(config.database);

  try {
    const connected = await pingDatabase(pool);
    if (!connected) {
      const error = new Error('MySQL connection check returned an unexpected result');
      error.code = 'DATABASE_UNAVAILABLE';
      throw error;
    }
    output.log?.('MySQL connection verified');

    const bootstrap = await bootstrapDatabase(pool);
    output.log?.(
      bootstrap.newlyApplied.length > 0
        ? `Applied migrations: ${bootstrap.newlyApplied.join(', ')}`
        : 'Database migrations are already current',
    );

    const existingAdmin = await findExistingAdmin(pool);
    if (existingAdmin) {
      output.log?.(`Administrator already exists: ${existingAdmin.email}`);
      output.log?.(`YunCMS API: http://${config.server.host}:${config.server.port}`);
      output.log?.(`YunCMS Studio: ${config.server.studioOrigin}`);
      return { bootstrap, admin: existingAdmin, existingAdmin: true };
    }

    output.log?.('YunCMS setup: first administrator');
    const adminInput = await collectAdmin(prompts);
    const admin = await createInitialAdmin(pool, adminInput);
    output.log?.(`Created administrator: ${admin.email}`);
    output.log?.(`YunCMS API: http://${config.server.host}:${config.server.port}`);
    output.log?.(`YunCMS Studio: ${config.server.studioOrigin}`);

    return { bootstrap, admin, existingAdmin: false };
  } finally {
    await closeDatabasePool(pool);
  }
}
