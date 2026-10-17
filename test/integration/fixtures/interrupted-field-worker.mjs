import { createDatabasePool, createSystemAccountability, FieldsService, loadConfig } from '@yunsoft/yuncms-core';

const config = loadConfig(process.env);
if (!/(test|ci|dev)/i.test(config.database.database) || process.env.YUNCMS_TEST_DB_ALLOW_DESTRUCTIVE !== '1') {
  throw Error('Disposable schema interruption database required');
}
const database = createDatabasePool(config.database);
try {
  await new FieldsService({ database, accountability: createSystemAccountability() })
    .createOne('recovery_records', JSON.parse(process.env.YUNCMS_INTERRUPTED_FIELD));
} finally { await database.end(); }
