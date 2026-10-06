import assert from 'node:assert/strict';
import test from 'node:test';
import {
  bootstrapDatabase, closeDatabasePool, CollectionsService, createAccountability,
  createCoreServiceRegistry, createDatabasePool, createSystemAccountability, FieldsService,
  HookEmitter, ItemsService, loadConfig, PermissionsService, quoteIdentifier,
  RolesService, SchemaCache, UsersService, withConnectionTransaction, withTransaction,
} from '@yunsoft/yuncms-core';
import { registerInternalAudit } from '../../packages/api/src/audit-hooks.js';
import { AiAutomationsService } from '../../packages/api/src/automations/service.js';

test('real MySQL: native transaction-bound Items defer audit and automation, including with a one-connection pool', {
  skip: process.env.YUNCMS_TEST_MYSQL !== '1', timeout: 30_000,
}, async () => {
  const config = loadConfig(process.env);
  if (process.env.YUNCMS_TEST_DB_ALLOW_DESTRUCTIVE !== '1' || !/(test|ci|dev)/i.test(config.database.database)) {
    throw new Error('Disposable MySQL database and explicit destructive opt-in required');
  }
  const database = createDatabasePool({ ...config.database, connectionLimit: 1 });
  const system = createSystemAccountability();
  const schemaCache = new SchemaCache({ versionCheckTtlMs: 0 });
  const options = { database, accountability: system, schemaCache };
  const services = createCoreServiceRegistry().toObject();
  const errors = [];
  const logger = { error: (...args) => errors.push(args), warn() {} };
  const emitter = new HookEmitter({ logger });
  const collection = `tx_items_${Date.now().toString(36)}`;
  const table = quoteIdentifier(collection);
  const collections = new CollectionsService(options);
  const roles = new RolesService(options);
  const users = new UsersService(options);
  let role, user, rule, automation;
  try {
    await bootstrapDatabase(database);
    await collections.createOne({ collection });
    for (const field of ['title', 'summary']) await new FieldsService(options).createOne(collection, { field, type: 'text' });
    role = await roles.createOne({ name: `Transaction actor ${Date.now()}` });
    user = await users.createOne({ email: `tx-${Date.now()}@example.test`, password: 'Disposable-Transaction-9173!', role: role.id });
    for (const action of ['read', 'update']) await new PermissionsService(options).createOne({
      role: role.id, collection, action, fields: action === 'read' ? ['id', 'title', 'summary'] : ['summary'],
    });
    const accountability = createAccountability({ user: user.id, admin: true });
    automation = new AiAutomationsService({ ...options, accountability, emitter, services, logger,
      assistant: { async generateFields() { throw new Error('enqueue must never contact a provider'); } },
      settingsStore: { async readRuntime() { return { enabled: false }; } },
    });
    rule = await automation.save({ name: 'Transaction enqueue', collection, run_as: user.id, enabled: true,
      on_create: true, on_update: true, input_fields: ['title'], output_fields: ['summary'], instruction: 'Summarize title.' });
    registerInternalAudit({ emitter, services, database, logger });
    for (const event of ['items.create', 'items.update']) {
      emitter.registerAction(event, (payload, context) => automation.enqueue(event, payload, context));
    }
    const items = connection => new ItemsService(collection, { ...options, database: connection, accountability, emitter });
    let committed;
    await withTransaction(database, async connection => {
      await connection.query('SELECT id FROM yuncms_users WHERE id = ? FOR UPDATE', [user.id]);
      committed = await items(connection).createOne({ title: 'Committed' });
      const [audit] = await connection.query('SELECT COUNT(*) AS total FROM yuncms_audit_log WHERE collection = ?', [collection]);
      const [jobs] = await connection.query('SELECT COUNT(*) AS total FROM yuncms_ai_automation_runs WHERE automation_id = ?', [rule.id]);
      assert.equal(Number(audit[0].total), 0);
      assert.equal(Number(jobs[0].total), 0);
    });
    assert.equal((await automation.runs(rule.id)).length, 1);
    assert.equal(Number((await database.query('SELECT COUNT(*) AS total FROM yuncms_audit_log WHERE collection = ?', [collection]))[0][0].total), 1);

    await assert.rejects(withTransaction(database, async connection => {
      await items(connection).createOne({ title: 'Rolled back' });
      await items(connection).updateOne(committed.id, { title: 'Discarded update' });
      await items(connection).deleteOne(committed.id);
      throw new Error('rollback fixture');
    }), /rollback fixture/);
    assert.equal((await automation.runs(rule.id)).length, 1);
    assert.equal(Number((await database.query('SELECT COUNT(*) AS total FROM yuncms_audit_log WHERE collection = ?', [collection]))[0][0].total), 1);
    assert.deepEqual((await database.query(`SELECT title FROM ${table}`))[0].map(row => row.title), ['Committed']);

    // The caller retains its connection; post-commit hooks must use it without borrowing another.
    const connection = await database.getConnection();
    try {
      await withConnectionTransaction(connection, async tx => {
        await tx.query('SELECT id FROM yuncms_users WHERE id = ? FOR UPDATE', [user.id]);
        await items(tx).createMany([{ title: 'Bulk one' }, { title: 'Bulk two' }]);
      });
    } finally { connection.release(); }
    assert.equal((await automation.runs(rule.id)).length, 3);
    assert.equal(Number((await database.query('SELECT COUNT(*) AS total FROM yuncms_audit_log WHERE collection = ?', [collection]))[0][0].total), 3);
    assert.deepEqual(errors, [], 'native audit and automation hooks must complete without lock or pool errors');
  } finally {
    if (rule) await database.query('DELETE FROM yuncms_ai_automation_runs WHERE automation_id = ?', [rule.id]);
    if (rule) await automation.remove(rule.id);
    await database.query('DELETE FROM yuncms_audit_log WHERE collection = ?', [collection]).catch(() => {});
    await collections.deleteOne(collection, { destructive: true }).catch(() => {});
    if (user) await users.deleteOne(user.id);
    if (role) await roles.deleteOne(role.id);
    await closeDatabasePool(database);
  }
});
