import {
  assertDatabaseCompatible,
  assertMaintenanceStartupAllowed,
  closeDatabasePool,
  createCoreServiceRegistry,
  createDatabasePool,
  createJsonLogger,
  createStorageRegistry,
  createSystemAccountability,
  HookEmitter,
  loadConfig,
  loadEnvFileIfPresent,
  LocalStorageDriver,
  MemoryCacheStore,
  RedisCacheStore,
  RedisClient,
  RedisFixedWindowStore,
  S3StorageDriver,
  SchemaCache,
  SmtpMailer,
} from '@yunsoft/yuncms-core';
import { createApp } from './app.js';
import { AiAssistantService } from './ai/service.js';
import { loadOrCreateAiSettingsKey } from './ai/secret-key.js';
import { AiSettingsStore } from './ai/settings-store.js';
import { INTERNAL_AUDIT_EVENTS } from './audit-events.js';
import { loadExternalAuthConfig } from './external-auth/config.js';
import { ExternalAuthProviderRegistry } from './external-auth/providers.js';
import { loadExtensionRuntime } from './extensions/runtime.js';
import { createMcpRouter } from './mcp.js';
import { createAiRouter } from './routes/ai.js';

loadEnvFileIfPresent();
await assertMaintenanceStartupAllowed({ cwd: process.cwd(), env: process.env });
const config = loadConfig();
const externalAuthConfig = loadExternalAuthConfig(process.env);
const logger = createJsonLogger({ level: config.logging.level });
const pool = createDatabasePool(config.database);
const storageDrivers = { local: new LocalStorageDriver({ root: config.storage.localRoot }) };
if (config.storage.s3.bucket) {
  storageDrivers.s3 = new S3StorageDriver({
    bucket: config.storage.s3.bucket,
    region: config.storage.s3.region,
    endpoint: config.storage.s3.endpoint ?? undefined,
    accessKeyId: config.storage.s3.accessKeyId ?? undefined,
    secretAccessKey: config.storage.s3.secretAccessKey ?? undefined,
    forcePathStyle: config.storage.s3.forcePathStyle,
  });
}
const storage = createStorageRegistry(storageDrivers);

const redisNeeded = config.cache.store === 'redis'
  || config.server.rateLimit.store === 'redis'
  || config.auth.rateLimit.store === 'redis';
const redisClient = redisNeeded ? new RedisClient({
  url: config.redis.url,
  connectTimeoutMs: config.redis.connectTimeoutMs,
  commandTimeoutMs: config.redis.commandTimeoutMs,
  logger,
}) : null;
const permissionCache = !config.cache.enabled ? null
  : config.cache.store === 'redis'
    ? new RedisCacheStore({ client: redisClient, prefix: config.redis.prefix, namespace: 'permission', ttlMs: config.cache.ttlMs, logger })
    : new MemoryCacheStore({ ttlMs: config.cache.ttlMs, maxEntries: config.cache.maxEntries });
const rateLimitStore = redisClient
  ? new RedisFixedWindowStore({ client: redisClient, prefix: config.redis.prefix, logger })
  : null;

const hasAnyMailConfig = Boolean(config.mail.host || config.mail.from || config.mail.user || config.mail.password);
if (hasAnyMailConfig && (!config.mail.host || !config.mail.from)) {
  throw new Error('SMTP_HOST and SMTP_FROM are both required when SMTP delivery is configured');
}
const mailer = config.mail.host ? new SmtpMailer({
  host: config.mail.host,
  port: config.mail.port,
  secure: config.mail.secure,
  user: config.mail.user,
  password: config.mail.password,
  from: config.mail.from,
}) : null;

let server = null;
let extensionRuntime = null;
let shuttingDown = false;

function registerInternalAudit({ emitter, services }) {
  const AuditService = services.AuditService;
  const systemAccountability = createSystemAccountability();
  for (const event of INTERNAL_AUDIT_EVENTS) {
    emitter.registerAction(event, async (payload, context) => {
      try {
        const audit = new AuditService({ accountability: systemAccountability, database: pool, logger, requestId: context.requestId ?? null });
        await audit.record({
          user: context.accountability?.user ?? null,
          action: event,
          collection: context.collection ?? null,
          itemKey: payload?.key ?? null,
          requestId: context.requestId ?? null,
          payload,
        });
      } catch (error) {
        logger.error('YunCMS audit write failed after committed mutation', { event, requestId: context.requestId ?? null, code: error?.code, error });
      }
    }, { extensionId: 'core.audit', priority: 1000 });
  }
}

async function start() {
  await assertDatabaseCompatible(pool);
  const aiKey = await loadOrCreateAiSettingsKey();
  const aiSettingsStore = new AiSettingsStore({ database: pool, key: aiKey.key });
  if (aiKey.created) logger.info('YunCMS AI settings encryption key created');

  if (redisClient) {
    try {
      await redisClient.connect();
      if (!await redisClient.ping()) throw new Error('Unexpected Redis ping result');
      logger.info('YunCMS shared Redis connected', { prefix: config.redis.prefix });
    } catch (error) {
      if (config.redis.required) throw error;
      logger.warn('YunCMS Redis unavailable at startup; safe fallbacks remain active', { code: error?.code ?? null });
    }
  }

  const serviceRegistry = createCoreServiceRegistry();
  const services = serviceRegistry.toObject();
  const schemaCache = new SchemaCache();
  const emitter = new HookEmitter({ logger });
  const externalAuthRegistry = new ExternalAuthProviderRegistry({
    config: externalAuthConfig,
    publicUrl: config.auth.publicUrl,
    database: pool,
    logger,
  });
  const aiAssistant = new AiAssistantService({ settingsStore: aiSettingsStore, logger });
  const aiRouter = createAiRouter({ assistant: aiAssistant, settingsStore: aiSettingsStore });
  const mcpRouter = createMcpRouter({ config, logger });
  mailer?.setEmitter(emitter);
  registerInternalAudit({ emitter, services });

  extensionRuntime = await loadExtensionRuntime({
    services,
    database: pool,
    schemaCache,
    emitter,
    storage,
    logger,
    env: config,
  });

  const app = createApp({
    pool,
    config,
    logger,
    serviceRegistry,
    schemaCache,
    permissionCache,
    emitter,
    storage,
    mailer,
    rateLimitStore,
    redisClient,
    externalAuthRegistry,
    endpointExtensions: extensionRuntime.endpointExtensions,
    aiRouter,
    mcpRouter,
  });

  await extensionRuntime.init('app.beforeStart');
  server = await new Promise((resolve, reject) => {
    const listeningServer = app.listen(config.server.port, config.server.host, () => {
      logger.info('YunCMS API listening', { host: config.server.host, port: config.server.port });
      resolve(listeningServer);
    });
    listeningServer.once('error', reject);
  });
  await extensionRuntime.init('app.afterStart');
  extensionRuntime.startSchedules();
}

async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info('YunCMS API shutting down', { signal });
  const forceExit = setTimeout(() => {
    logger.error('Graceful shutdown timed out', { signal });
    process.exit(1);
  }, 10_000);
  forceExit.unref();

  const schedulesStopped = await extensionRuntime?.stopSchedules({ timeoutMs: 5_000 }).catch(() => false);
  if (schedulesStopped === false) {
    logger.warn('YunCMS extension jobs exceeded graceful shutdown budget', { signal });
  }
  await extensionRuntime?.init('app.beforeStop').catch((error) => {
    logger.error('YunCMS extension beforeStop hook failed', { code: error?.code ?? null });
  });
  if (server) await new Promise((resolve) => server.close(resolve));
  await redisClient?.close().catch(() => {});
  await closeDatabasePool(pool);
  await extensionRuntime?.init('app.afterStop').catch(() => {});
  clearTimeout(forceExit);
  logger.info('YunCMS API shutdown complete', { signal });
}

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.once(signal, () => {
    shutdown(signal)
      .then(() => process.exit(0))
      .catch((error) => {
        logger.error('Graceful shutdown failed', { signal, error });
        process.exit(1);
      });
  });
}

start().catch(async (error) => {
  logger.error('YunCMS API failed to start', { code: error?.code, error });
  await redisClient?.close().catch(() => {});
  await closeDatabasePool(pool).catch(() => {});
  process.exit(1);
});