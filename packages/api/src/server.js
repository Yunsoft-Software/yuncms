import {
  assertDatabaseCompatible,
  closeDatabasePool,
  createDatabasePool,
  loadConfig,
  loadEnvFileIfPresent,
} from '@yuncms/core';
import { createApp } from './app.js';

loadEnvFileIfPresent();
const config = loadConfig();
const pool = createDatabasePool(config.database);
let server = null;
let shuttingDown = false;

async function start() {
  await assertDatabaseCompatible(pool);

  const app = createApp({ pool, config });
  server = app.listen(config.server.port, config.server.host, () => {
    console.log(`YunCMS API listening on http://${config.server.host}:${config.server.port}`);
  });
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
