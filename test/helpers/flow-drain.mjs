import { createCoreServiceRegistry, createDatabasePool, createSystemAccountability, FlowsService, HookEmitter, loadConfig, createJsonLogger } from '@yunsoft/yuncms-core';
import { setTimeout as delay } from 'node:timers/promises';

const config = loadConfig(process.env);
if (process.env.YUNCMS_TEST_MYSQL !== '1' || process.env.YUNCMS_TEST_DB_ALLOW_DESTRUCTIVE !== '1' || !/(test|ci|dev)/i.test(config.database.database)) throw Error('Disposable database authorization required');
const database = createDatabasePool({ ...config.database, connectionLimit: 2 }), logger = createJsonLogger({ level: 'error' });
const service = new FlowsService({ database, accountability: createSystemAccountability(), services: createCoreServiceRegistry().toObject(), emitter: new HookEmitter({ logger }), logger });
try {
  const start = process.argv.includes('--await-start') ? new Promise(resolve => process.once('message', message => {
    if (message?.start !== true) throw Error('Expected native worker start signal');
    resolve();
  })) : null;
  await database.query('SELECT 1');
  process.send?.({ ready: true });
  if (start) await start;
  let claimed = 0;
  const deadline = Date.now() + 30000;
  while (true) {
    if (await service.runNext()) { claimed++; continue; }
    if (!start) break;
    // SKIP LOCKED may report no claim while another worker briefly holds the
    // pending rows. Keep polling the real queue instead of ending this worker.
    const [[row]] = await database.query("SELECT COUNT(*) AS total FROM yuncms_flow_runs WHERE status = 'pending'");
    if (!Number(row.total)) break;
    if (Date.now() >= deadline) throw Error('Native queue did not drain within the worker deadline');
    await delay(25);
  }
  process.send?.({ done: true, claimed });
} finally { await database.end(); process.disconnect?.(); }
