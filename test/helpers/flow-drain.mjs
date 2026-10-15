import { createCoreServiceRegistry, createDatabasePool, createSystemAccountability, FlowsService, HookEmitter, loadConfig, createJsonLogger } from '@yunsoft/yuncms-core';

const config = loadConfig(process.env);
if (process.env.YUNCMS_TEST_MYSQL !== '1' || process.env.YUNCMS_TEST_DB_ALLOW_DESTRUCTIVE !== '1' || !/(test|ci|dev)/i.test(config.database.database)) throw Error('Disposable database authorization required');
const database = createDatabasePool({ ...config.database, connectionLimit: 2 }), logger = createJsonLogger({ level: 'error' });
const service = new FlowsService({ database, accountability: createSystemAccountability(), services: createCoreServiceRegistry().toObject(), emitter: new HookEmitter({ logger }), logger });
try {
  process.send?.({ ready: true });
  let claimed = 0;
  while (await service.runNext()) claimed++;
  process.send?.({ done: true, claimed });
} finally { await database.end(); process.disconnect?.(); }
