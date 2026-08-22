import {
  assertDatabaseCompatible,
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
  S3StorageDriver,
  SchemaCache,
  SmtpMailer,
} from '@yunsoft/yuncms-core';
import { createApp } from './app.js';
import { INTERNAL_AUDIT_EVENTS } from './audit-events.js';
import { loadExtensionRuntime } from './extensions/runtime.js';

loadEnvFileIfPresent();
const config = loadConfig();
const logger = createJsonLogger({ level: config.logging.level });
const pool = createDatabasePool(config.database);
const storageDrivers = {
  local: new LocalStorageDriver({ root: config.storage.localRoot }),
};
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
const permissionCache = config.cache.enabled
  ? new MemoryCacheStore({
    ttlMs: config.cache.ttlMs,
    maxEntries: config.cache.maxEntries,
  })
  : null;

const hasAnyMailConfig = Boolean(
  config.mail.host || config.mail.from || config.mail.user || config.mail.password,
);
if (hasAnyMailConfig && (!config.mail.host || !config.mail.from)) {
  throw new Error('SMTP_HOST and SMTP_FROM are both required when SMTP delivery is configured');
}
const mailer = config.mail.host
  ? new SmtpMailer({
    host: config.mail.host,
    port: config.mail.port,
    secure: config.mail.secure,
    user: config.mail.user,
    password: config.mail.password,
    from: config.mail.from,
  })
  : null;

let server = null;
let shuttingDown = false;

function registerInternalAudit({ emitter, services }) {
  const AuditService = services.AuditService;
  const systemAccountability = createSystemAccountability();

  for (const event of INTERNAL_AUDIT_EVENTS) {
    emitter.registerAction(event, async (payload, context) => {
      try {
        const audit = new AuditService({
          accountability: systemAccountability,
          database: pool,
          logger,
          requestId: context.requestId ?? null,
        });
        await audit.record({
          user: context.accountability?.user ?? null,
          action: event,
          collection: context.collection ?? null,
          itemKey: payload?.key ?? null,
          requestId: context.requestId ?? null,
          payload,
        });
      } catch (error) {
        logger.error('YunCMS audit write failed after committed mutation', {
          event,
          requestId: context.requestId ?? null,
          code: error?.code,
          error,
        });
      }
    });
  }
}

async function start() {
  await assertDatabaseCompatible(pool);

  const serviceRegistry = createCoreServiceRegistry();
  const services = serviceRegistry.toObject();
  const schemaCache = new SchemaCache();
  const emitter = new HookEmitter();
  registerInternalAudit({ emitter, services });

  const extensionRuntime = await loadExtensionRuntime({
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
    endpointExtensions: extensionRuntime.endpointExtensions,
  });

  await extensionRuntime.init('app.beforeStart');
  server = await new Promise((resolve, reject) => {
    const listeningServer = app.listen(config.server.port, config.server.host, () => {
      logger.info('YunCMS API listening', {
        host: config.server.host,
        port: config.server.port,
      });
      resolve(listeningServer);
    });
    listeningServer.once('error', reject);
  });
  await extensionRuntime.init('app.afterStart');
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

  if (server) {
    await new Promise((resolve) => server.close(resolve));
  }
  await closeDatabasePool(pool);
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
  logger.error('YunCMS API failed to start', {
    code: error?.code,
    error,
  });
  await closeDatabasePool(pool).catch(() => {});
  process.exit(1);
});
