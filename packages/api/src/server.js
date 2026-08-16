import { closeDatabasePool, createDatabasePool, loadConfig } from '@yuncms/core';
import { createApp } from './app.js';

const config = loadConfig();
const pool = createDatabasePool(config.database);
const app = createApp({ pool, config });

const server = app.listen(config.server.port, config.server.host, () => {
  console.log(`YunCMS API listening on http://${config.server.host}:${config.server.port}`);
});

let shuttingDown = false;

async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`Received ${signal}; shutting down YunCMS API`);

  const forceExit = setTimeout(() => {
    console.error('Graceful shutdown timed out');
    process.exit(1);
  }, 10_000);
  forceExit.unref();

  await new Promise((resolve) => server.close(resolve));
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
