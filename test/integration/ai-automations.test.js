import assert from 'node:assert/strict';
import test from 'node:test';
import {
  bootstrapDatabase, closeDatabasePool, CollectionsService, createCoreServiceRegistry, createDatabasePool,
  createSystemAccountability, FieldsService, HookEmitter, ItemsService, loadConfig,
  PermissionsService, RolesService, SchemaCache, UsersService,
} from '@yunsoft/yuncms-core';
import { AiAssistantService } from '../../packages/api/src/ai/service.js';
import { AiAutomationsService } from '../../packages/api/src/automations/service.js';
import { AiAutomationWorker } from '../../packages/api/src/automations/worker.js';
import { createAutomationsRouter } from '../../packages/api/src/routes/automations.js';
import { createApp } from '../../packages/api/src/app.js';

test('real MySQL: AI automations preserve permissions, queue/restart/rollback boundaries and concurrent edits', {
  skip: process.env.YUNCMS_TEST_MYSQL !== '1', timeout: 90000,
}, async () => {
  const config = loadConfig(process.env);
  if (process.env.YUNCMS_TEST_DB_ALLOW_DESTRUCTIVE !== '1' || !/(test|ci|dev)/i.test(config.database.database)) throw new Error('Disposable MySQL database and explicit destructive opt-in required');
  const database = createDatabasePool(config.database);
  const system = createSystemAccountability();
  const schemaCache = new SchemaCache({ versionCheckTtlMs: 0 });
  const services = createCoreServiceRegistry().toObject();
  const emitter = new HookEmitter({ logger: { error() {} } });
  const options = { database, accountability: system, schemaCache, emitter };
  const collection = `ai_requests_${Date.now().toString(36)}`;
  const ownerEmail = `ai_owner_${Date.now()}@example.test`;
  let role, ownerRole, actor, rule, server;
  let generated = 0, providerFailure = null, duringGeneration = null, rejectMutation = false;
  const settings = { enabled: true, writesEnabled: true, apiKey: 'local-test-only', model: 'test',
    baseUrl: 'https://provider.invalid/v1', timeoutMs: 1000, maxMessageChars: 12000, maxOutputTokens: 1500 };
  const settingsStore = { async readRuntime() { return settings; } };
  const assistant = new AiAssistantService({ settingsStore, fetchImpl: async (_url, request) => {
    generated += 1;
    const body = JSON.parse(request.body);
    const input = JSON.parse(body.messages[1].content).record;
    assert.deepEqual(Object.keys(input), ['message']);
    assert.equal(JSON.stringify(body).includes('private-secret'), false);
    if (duringGeneration) { const operation = duringGeneration; duringGeneration = null; await operation(); }
    if (providerFailure) throw Object.assign(new Error('test provider offline'), { code: providerFailure });
    return { ok: true, async text() { return JSON.stringify({ choices: [{ message: { role: 'assistant', content: JSON.stringify({ summary: `Summary: ${input.message}` }) } }] }); } };
  } });
  let owner;
  const automationOptions = { assistant, settingsStore, schemaCache };
  let automation;
  const collections = new CollectionsService(options);
  const fields = new FieldsService(options);
  const roles = new RolesService(options);
  const users = new UsersService(options);
  const permissions = new PermissionsService(options);
  const items = () => new ItemsService(collection, options);
  try {
    await bootstrapDatabase(database);
    ownerRole = await roles.createOne({ name: `AI Owner ${Date.now()}`, admin: true });
    owner = await users.createOne({ email: ownerEmail, password: 'Disposable-Ai-Owner-9417!', role: ownerRole.id });
    await collections.createOne({ collection });
    for (const field of ['message', 'summary', 'secret']) await fields.createOne(collection, { field, type: 'text' });
    role = await roles.createOne({ name: `AI Worker ${Date.now()}` });
    actor = await users.createOne({ email: `ai_actor_${Date.now()}@example.test`, password: 'Disposable-Ai-Actor-9417!', role: role.id });
    await permissions.createOne({ role: role.id, collection, action: 'read', fields: ['id', 'message', 'summary'] });
    await permissions.createOne({ role: role.id, collection, action: 'update', fields: ['summary'], filter: { message: { _neq: 'blocked' } } });
    automation = new AiAutomationsService({ ...automationOptions, ...options, accountability: { user: owner.id, admin: true }, services });
    const initialDefinition = { name: 'Summarize requests', collection, run_as: actor.id, enabled: true,
      on_create: true, on_update: true, input_fields: ['message'], output_fields: ['summary'], instruction: 'Summarize the supplied message.' };
    rule = await automation.save(initialDefinition);
    for (const event of ['items.create', 'items.update']) emitter.registerAction(event, (payload, context) => automation.enqueue(event, payload, context));
    emitter.registerFilter('items.update', (payload) => { if (rejectMutation && Object.hasOwn(payload, 'summary')) throw Object.assign(new Error('Test validation failure'), { code: 'VALIDATION_FAILED' }); return payload; });
    const worker = new AiAutomationWorker(automation);
    const first = await items().createOne({ message: 'hello', secret: 'private-secret' });
    assert.equal((await automation.runs(rule.id))[0].status, 'pending');
    const proposed = await automation.preview(initialDefinition, String(first.id));
    assert.equal(proposed.proposed.summary, 'Summary: hello');
    assert.equal((await items().readOne(first.id)).summary, null);
    const beforeConcurrent = generated;
    await Promise.all([worker.tick(), new AiAutomationWorker(automation).tick()]);
    assert.equal(generated, beforeConcurrent + 1);
    assert.equal((await items().readOne(first.id)).summary, 'Summary: hello');
    assert.equal((await automation.runs(rule.id)).length, 1); // Generated update does not enqueue itself.
    assert.equal((await automation.runs(rule.id))[0].status, 'succeeded');

    // Multiple pending source changes coalesce and process the latest value.
    await items().updateOne(first.id, { message: 'one' });
    await items().updateOne(first.id, { message: 'two' });
    assert.equal((await automation.runs(rule.id)).filter((entry) => entry.status === 'pending').length, 1);
    await worker.tick(); assert.equal((await items().readOne(first.id)).summary, 'Summary: two');

    // A manual output edit during the provider request must survive.
    await items().updateOne(first.id, { message: 'three' });
    duringGeneration = () => items().updateOne(first.id, { summary: 'manual' });
    await worker.tick(); assert.equal((await items().readOne(first.id)).summary, 'manual');
    assert.ok((await automation.runs(rule.id)).some((entry) => entry.status === 'skipped'));

    // Database-side row permission prevents writes, even though the AI could read the source.
    const blocked = await items().createOne({ message: 'blocked' });
    await worker.tick(); assert.equal((await items().readOne(blocked.id)).summary, null);
    assert.ok((await automation.runs(rule.id)).some((entry) => entry.status === 'failed' && entry.error_code === 'FORBIDDEN'));

    // A failing filter rolls back both the item and the successful-run marker.
    rejectMutation = true;
    const rollback = await items().createOne({ message: 'rollback' });
    await worker.tick(); assert.equal((await items().readOne(rollback.id)).summary, null);
    rejectMutation = false;

    // Suspended identities are rechecked at execution time.
    await items().createOne({ message: 'suspended' });
    await users.updateOne(actor.id, { status: 'suspended' });
    await worker.tick();
    assert.ok((await automation.runs(rule.id)).some((entry) => entry.error_code === 'INVALID_AUTOMATION'));
    await users.updateOne(actor.id, { status: 'active' });

    // Provider outages retry with bounded attempts and persist across worker instances.
    await items().createOne({ message: 'retry' }); providerFailure = 'offline';
    await worker.tick();
    const retryRun = (await automation.runs(rule.id)).find((entry) => entry.status === 'pending');
    assert.equal(retryRun.attempts, 1); assert.equal(retryRun.error_code, 'AI_PROVIDER_UNAVAILABLE');
    await database.query("UPDATE yuncms_ai_automation_runs SET status = 'running' WHERE id = ?", [retryRun.id]);
    providerFailure = null;
    await new AiAutomationWorker(automation).tick();
    assert.equal((await automation.runs(rule.id)).find((entry) => entry.id === retryRun.id).status, 'succeeded');

    // Rule revisions invalidate pending work; disabling AI writes produces a visible failure.
    await items().createOne({ message: 'old rule' });
    const definition = { name: rule.name, collection, run_as: actor.id, enabled: true, on_create: true, on_update: true,
      input_fields: ['message'], output_fields: ['summary'], instruction: 'Updated instruction.' };
    rule = await automation.save(definition, rule.id); await worker.tick();
    await items().createOne({ message: 'writes off' }); settings.writesEnabled = false;
    await worker.tick(); settings.writesEnabled = true;
    const offRun = (await automation.runs(rule.id)).find((entry) => entry.error_code === 'AI_WRITES_DISABLED');
    assert.ok(offRun); await automation.retry(offRun.id); await worker.tick();
    assert.equal((await automation.runs(rule.id)).find((entry) => entry.id === offRun.id).status, 'succeeded');

    await assert.rejects(automation.save({ ...definition, input_fields: ['secret'] }), { code: 'FORBIDDEN_FIELD' });
    await assert.rejects(automation.save({ ...definition, output_fields: ['id'] }), { code: 'INVALID_AUTOMATION' });
    await assert.rejects(database.query("UPDATE yuncms_ai_automation_runs SET status = 'invented' WHERE id = ?", [offRun.id]));

    // Real HTTP authentication boundaries use the same service as Studio/MCP.
    const app = createApp({ pool: database, config, schemaCache, emitter, logger: { error() {}, warn() {} },
      automationsRouter: createAutomationsRouter(automationOptions) });
    server = app.listen(0, '127.0.0.1'); await new Promise((resolve) => server.once('listening', resolve));
    const origin = `http://127.0.0.1:${server.address().port}`;
    assert.equal((await fetch(`${origin}/automations`)).status, 401);
    const login = async (email, password) => (await (await fetch(`${origin}/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password }) })).json()).data.access_token;
    const actorToken = await login(actor.email, 'Disposable-Ai-Actor-9417!');
    assert.equal((await fetch(`${origin}/automations`, { headers: { authorization: `Bearer ${actorToken}` } })).status, 403);
    const ownerToken = await login(ownerEmail, 'Disposable-Ai-Owner-9417!');
    assert.equal((await fetch(`${origin}/automations`, { headers: { authorization: `Bearer ${ownerToken}` } })).status, 200);
  } finally {
    const cleanupErrors = [];
    if (server) {
      try {
        await new Promise((resolve, reject) => {
          server.close((error) => (error ? reject(error) : resolve()));
        });
      } catch (error) {
        cleanupErrors.push(error);
      }
    }
    if (rule) {
      try {
        await database.query('DELETE FROM yuncms_ai_automations WHERE id = ?', [rule.id]);
      } catch (error) {
        cleanupErrors.push(error);
      }
    }
    try {
      await collections.deleteOne(collection, { destructive: true });
    } catch (error) {
      cleanupErrors.push(error);
    }
    if (actor) {
      try {
        await users.deleteOne(actor.id);
      } catch (error) {
        cleanupErrors.push(error);
      }
    }
    if (role) {
      try {
        await roles.deleteOne(role.id);
      } catch (error) {
        cleanupErrors.push(error);
      }
    }
    if (owner) {
      try {
        await users.deleteOne(owner.id);
      } catch (error) {
        cleanupErrors.push(error);
      }
    }
    // Native V1 RolesService.deleteOne deliberately rejects deleting administrator roles (PROTECTED_ROLE),
    // and V1 provides no admin demotion operation. For disposable integration test fixture teardown only,
    // explicitly remove the synthetic admin role via SQL after verifying synthetic ownership and zero remaining users.
    if (ownerRole?.id) {
      try {
        if (!ownerRole.name?.startsWith('AI Owner ') || !ownerRole.admin) {
          throw new Error(`Untracked or non-synthetic admin role encountered during teardown: ${ownerRole.name}`);
        }
        const [remainingUsers] = await database.query(
          'SELECT COUNT(*) AS count FROM yuncms_users WHERE role = ?',
          [ownerRole.id],
        );
        if (Number(remainingUsers?.[0]?.count ?? 0) > 0) {
          throw new Error(`Cannot teardown synthetic admin role ${ownerRole.id} while fixture users remain attached`);
        }
        await database.query(
          'DELETE FROM yuncms_roles WHERE id = ? AND name = ? AND admin = 1',
          [ownerRole.id, ownerRole.name],
        );
      } catch (error) {
        cleanupErrors.push(error);
      }
    }
    try {
      await closeDatabasePool(database);
    } catch (error) {
      cleanupErrors.push(error);
    }
    if (cleanupErrors.length > 0) {
      if (cleanupErrors.length === 1) throw cleanupErrors[0];
      throw new AggregateError(cleanupErrors, `Cleanup failed with ${cleanupErrors.length} error(s)`);
    }
  }
});
