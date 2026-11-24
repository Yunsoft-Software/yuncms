import { existsSync } from 'node:fs';
import { join } from 'node:path';

import {
  DEFAULT_SERVER_PORT,
  bootstrapDatabase,
  closeDatabasePool,
  createDatabasePool,
  createInitialAdmin,
  findExistingAdmin,
  loadConfig,
  pingDatabase,
  resolvePremiumOfferUrl,
} from '@yunsoft/yuncms-core';

import { writeEnvFile } from './env-file.js';
import { createInteractivePrompts } from './prompts.js';
import { ensureProjectScaffold } from './project-scaffold.js';

export async function collectEnvironment(prompts) {
  const DB_HOST = await prompts.line('MySQL host', { defaultValue: '127.0.0.1' });
  const DB_PORT = await prompts.line('MySQL port', { defaultValue: '3306' });
  const DB_DATABASE = await prompts.line('MySQL database', { defaultValue: 'yuncms' });
  const DB_USER = await prompts.line('MySQL user', { defaultValue: 'yuncms' });
  const DB_PASSWORD = await prompts.secret('MySQL password');
  const DB_SSL = await prompts.line('Use MySQL TLS (true/false)', { defaultValue: 'false' });
  const studioUrl = `http://localhost:${DEFAULT_SERVER_PORT}`;

  return {
    HOST: '127.0.0.1',
    PORT: String(DEFAULT_SERVER_PORT),
    STUDIO_ORIGIN: studioUrl,
    AUTH_PUBLIC_URL: studioUrl,
    FILES_LOCAL_ROOT: 'uploads',
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

export function parseOptInResponse(answer) {
  const normalized = String(answer ?? '').trim().toLowerCase();
  return ['y', 'yes', 'e', 'evet'].includes(normalized);
}

export async function offerOptionalPremiumSubscription({
  env = process.env,
  prompts = null,
  output = console,
  isTTY = Boolean(process.stdin.isTTY && process.stdout.isTTY),
  interactive = null,
} = {}) {
  const url = resolvePremiumOfferUrl(env.YUNCMS_PREMIUM_OFFER_URL);
  if (!url) {
    return { configured: false, optedIn: false, url: null };
  }
  const canPrompt = interactive ?? (Boolean(prompts) && !env.CI && isTTY);
  if (!canPrompt || !prompts) {
    return { configured: true, optedIn: false, url: null };
  }

  const answer = await prompts.line(
    "Optional: view Yunsoft's 3-month no-card Premium offer (verified email subscription on Yunsoft Website)? (y/N)",
    { defaultValue: 'n' },
  );
  if (!parseOptInResponse(answer)) {
    return { configured: true, optedIn: false, url: null };
  }

  output.log?.('\nOptional 3-month Premium offer (no credit card; complete verified email subscription directly on Yunsoft Website):');
  output.log?.(`  ${url}`);
  output.log?.('YunCMS did not send your email, license key or installation details. After receiving your signed entitlement token (JWT), paste it in Studio under Settings -> Features and license.');
  return { configured: true, optedIn: true, url };
}

export async function runInitCommand({
  env = process.env,
  cwd = process.cwd(),
  output = console,
  prompts,
  isTTY = Boolean(process.stdin.isTTY && process.stdout.isTTY),
} = {}) {
  const hasExplicitPrompts = Boolean(prompts);
  const activePrompts = prompts ?? createInteractivePrompts();
  const envPath = join(cwd, '.env');
  const workingEnv = { ...env };
  const scaffold = await ensureProjectScaffold({ cwd });

  if (scaffold.created.length > 0) {
    output.log?.(`Created project scaffold: ${scaffold.created.join(', ')}`);
  }

  if (!existsSync(envPath)) {
    output.log?.('YunCMS setup: database configuration');
    const collected = await collectEnvironment(activePrompts);
    const configuredOfferUrl = resolvePremiumOfferUrl(workingEnv.YUNCMS_PREMIUM_OFFER_URL);
    if (configuredOfferUrl) {
      collected.YUNCMS_PREMIUM_OFFER_URL = configuredOfferUrl;
    }
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
      const premiumOffer = await offerOptionalPremiumSubscription({
        env: workingEnv,
        prompts: activePrompts,
        output,
        isTTY,
        interactive: !workingEnv.CI && (hasExplicitPrompts || isTTY),
      });
      return { bootstrap, admin: existingAdmin, existingAdmin: true, premiumOffer };
    }

    output.log?.('YunCMS setup: first administrator');
    const adminInput = await collectAdmin(activePrompts);
    const admin = await createInitialAdmin(pool, adminInput);
    output.log?.(`Created administrator: ${admin.email}`);
    output.log?.(`YunCMS API: http://${config.server.host}:${config.server.port}`);
    output.log?.(`YunCMS Studio: ${config.server.studioOrigin}`);
    const premiumOffer = await offerOptionalPremiumSubscription({
      env: workingEnv,
      prompts: activePrompts,
      output,
      isTTY,
      interactive: !workingEnv.CI && (hasExplicitPrompts || isTTY),
    });

    return { bootstrap, admin, existingAdmin: false, premiumOffer };
  } finally {
    await closeDatabasePool(pool);
  }
}
