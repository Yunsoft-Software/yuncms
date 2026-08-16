import {
  assertDatabaseCompatible,
  closeDatabasePool,
  createCoreServiceRegistry,
  createDatabasePool,
  createStorageRegistry,
  createSystemAccountability,
  HookEmitter,
  loadConfig,
  loadEnvFileIfPresent,
  LocalStorageDriver,
  S3StorageDriver,
  SchemaCache,
} from '@yuncms/core';
import { createApp } from './app.js';
import { loadExtensionRuntime } from './extensions/runtime.js';

loadEnvFileIfPresent();
const config = loadConfig();
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
let server = null;
let shuttingDown = false;

function registerInternalAudit({ emitter, services }) {
  const AuditService = services.AuditService;
  const systemAccountability = createSystemAccountability();

  for (const event of ['items.create', 'items.update', 'items.delete']) {
    emitter.registerAction(event, async (payload, context) => {
      try {
        const audit = new AuditService({
          accountability: systemAccountability,
          database: pool,
          logger: console,
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
        console.error('YunCMS audit write failed after committed mutation', {
          event,
          requestId: context.requestId ?? null,
          code: error?.code,
          message: error?.message,
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
    logger: console,
    env: config,
  });

  const app = createApp({
    pool,
    config,
    serviceRegistry,
    schemaCache,
    emitter,
    storage,
    endpointExtensions: extensionRuntime.endpointExtensions,
  });

  await extensionRuntime.init('app.beforeStart');
  server = await new Promise((resolve, reject) => {
    const listeningServer = app.listen(config.server.port, config.server.host, () => {
      console.log(`YunCMS API listening on http://${config.server.host}:${config.server.port}`);
      resolve(listeningServer);
    });
    listeningServer.once('error', reject);
  });
  await extensionRuntime.init('app.afterStart');
}

async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`Received ${signal}; shutting down YunCMS API`);

  const forceExit = setTimeout(() => {
    console.error('Graceful shutdown timed out');
    process.exit(1);
  }, 10_000);
  forceExit.unref();

  if (server) {
    await new Promise((resolve) => server.close(resolve));
  }
  await closeDatabasePool(pool);
  clearTimeout(forceExit);
}

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.once(signal, () => {
    shutdown(signal)
      .then(() => process.exit(0))
      .catch((error) => {
        console.error('Graceful shutdown failed', error);
        process.exit(1);
      });
  });
}

start().catch(async (error) => {
  console.error('YunCMS API failed to start', {
    code: error?.code,
    message: error?.message,
  });
  await closeDatabasePool(pool).catch(() => {});
  process.exit(1);
});
