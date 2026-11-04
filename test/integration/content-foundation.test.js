import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash, generateKeyPairSync, randomUUID, randomBytes, sign } from 'node:crypto';
import { bootstrapDatabase, closeDatabasePool, CollectionsService, ContentRevisionsService,
  createAccountability, createDatabasePool, createFeaturePolicy, createSystemAccountability,
  FeaturesService, FieldsService, FlowsService, ItemsService, RelationsService, loadConfig, PermissionsService, RolesService,
  SchemaCache, UsersService, createCoreServiceRegistry, withTransaction } from '@yunsoft/yuncms-core';
import { saveNestedRelations } from '../../apps/studio/src/content-relations.js';
import { withEditState } from '../../apps/studio/src/content-edit-state.js';
import { AiSettingsStore } from '../../packages/api/src/ai/settings-store.js';
import { AiAssistantService } from '../../packages/api/src/ai/service.js';
import { createAiRouter } from '../../packages/api/src/routes/ai.js';
import { createMcpRouter } from '../../packages/api/src/mcp.js';
import { McpSettingsStore } from '../../packages/api/src/mcp/settings-store.js';
import { AiAutomationsService } from '../../packages/api/src/automations/service.js';
import { createApp } from '../../packages/api/src/app.js';

test('real MySQL/HTTP: shared Free/Premium runtime, exact concurrent edits, protected history and transactional rollback', {
  skip: process.env.YUNCMS_TEST_MYSQL !== '1', timeout: 60_000,
}, async t => {
  const config = loadConfig(process.env);
  if (process.env.YUNCMS_TEST_DB_ALLOW_DESTRUCTIVE !== '1' || !/^yuncms_test_[a-z0-9_]+$/.test(config.database.database)
    || !['127.0.0.1', 'localhost', '::1'].includes(config.database.host)) throw new Error('Explicit disposable local MySQL required');
  const database = createDatabasePool(config.database);
  const suffix = randomUUID().replaceAll('-', '').slice(0, 12);
  const collection = `v2_content_${suffix}`;
  const schemaCache = new SchemaCache({ versionCheckTtlMs: 0 });
  const keys = generateKeyPairSync('ed25519');
  const publicKey = keys.publicKey.export({ type: 'spki', format: 'pem' });
  const kid = createHash('sha256').update(keys.publicKey.export({ type: 'spki', format: 'der' })).digest('hex').slice(0, 16);
  const now = Math.floor(Date.now() / 1000);
  const issue = (patch = {}) => {
    const header = Buffer.from(JSON.stringify({ alg: 'EdDSA', crv: 'Ed25519', typ: 'YUNSOFT-ENTITLEMENT+JWT', kid })).toString('base64url');
    const payload = Buffer.from(JSON.stringify({ iss: 'yunsoft-commerce', sub: `license-${suffix}`, productCode: 'yuncms_premium',
      status: 'active', billingModel: 'one_time_perpetual', iat: now, nbf: now - 1, exp: null,
      allowedHosts: ['example.test'], capabilities: { contentHistory: true }, ...patch })).toString('base64url');
    return `${header}.${payload}.${sign(null, Buffer.from(`${header}.${payload}`), keys.privateKey).toString('base64url')}`;
  };
  const featureConfig = { publicKey, domain: 'example.test' };
  const options = { database, schemaCache, accountability: createSystemAccountability(), featurePolicy: createFeaturePolicy(featureConfig) };
  const features = new FeaturesService(options);
  const collections = new CollectionsService(options);
  const items = new ItemsService(collection, options);
  const revisions = new ContentRevisionsService(collection, options);
  const flowIds = [], junctionCollections = [], childCollections = [], extraUsers = [], extraRoles = [];
  let adminRole, adminUser, role, user, server, record, priorLicense, priorSettings;
  try {
    await bootstrapDatabase(database);
    [priorLicense] = await database.query('SELECT * FROM yuncms_license_state');
    [priorSettings] = await database.query('SELECT * FROM yuncms_feature_settings');
    // Restore the exact prior state even when a subtest fails.
    await database.query('DELETE FROM yuncms_license_state WHERE id = 1');
    await database.query('DELETE FROM yuncms_feature_settings');
    await collections.createOne({ collection, metadata: { contentTracking: { enabled: true, history: true } } });
    for (const field of ['title', 'private_secret']) await new FieldsService(options).createOne(collection, { field, type: 'string' });
    role = await new RolesService(options).createOne({ name: `V2 editor ${suffix}` });
    user = await new UsersService(options).createOne({ email: `v2-editor-${suffix}@example.test`, password: 'V2-editor-Test-9371!', role: role.id });
    for (const action of ['read', 'update']) await new PermissionsService(options).createOne({ role: role.id, collection,
      action, fields: action === 'read' ? ['id', 'title'] : ['title'] });
    adminRole = await new RolesService(options).createOne({ name: `V2 admin ${suffix}`, admin: true });
    adminUser = await new UsersService(options).createOne({ email: `v2-admin-${suffix}@example.test`, password: 'V2-admin-Test-9371!', role: adminRole.id });
    const app = createApp({ pool: database, schemaCache, config: { ...config, features: featureConfig,
      server: { ...config.server, rateLimit: { enabled: false }, pressure: { enabled: false } } },
    aiRouter: createAiRouter({ assistant: new AiAssistantService({ config: { enabled: false } }), settingsStore: new AiSettingsStore({ database, key: randomBytes(32) }) }),
    mcpRouter: createMcpRouter({ settingsStore: new McpSettingsStore({ database }) }),
    logger: { error() {}, warn() {}, info() {} } });
    server = await new Promise(resolve => { const listener = app.listen(0, '127.0.0.1', () => resolve(listener)); });
    const base = `http://127.0.0.1:${server.address().port}`;
    const request = async (path, { method = 'GET', body, token, headers = {} } = {}) => {
      const response = await fetch(base + path, { method, headers: { ...headers, ...(token ? { authorization: `Bearer ${token}` } : {}),
        ...(body === undefined ? {} : { 'content-type': 'application/json' }) }, body: body === undefined ? undefined : JSON.stringify(body) });
      return { status: response.status, body: response.status === 204 ? null : await response.json() };
    };
    const login = async (account, password) => {
      const result = await request('/auth/login', { method: 'POST', body: { email: account.email, password } });
      assert.equal(result.status, 200); return result.body.data.access_token;
    };
    const adminToken = await login(adminUser, 'V2-admin-Test-9371!');
    const editorToken = await login(user, 'V2-editor-Test-9371!');

    await t.test('unlicensed default retains native CRUD and denies Premium without exposing tokens', async () => {
      record = await items.createOne({ title: 'Initial', private_secret: 'never snapshot this' });
      assert.equal((await items.readEditState(record.id)).revision, '1');
      assert.equal((await features.readStatus()).features.contentHistory.enabled, false);
      await assert.rejects(revisions.readRevisions(record.id), { code: 'FEATURE_NOT_LICENSED' });
      const result = await request('/features', { token: editorToken });
      assert.equal(result.status, 200); assert.equal(Object.hasOwn(result.body.data, 'license'), false);
      assert.equal((await request('/features/contentHistory', { token: editorToken, method: 'PATCH', body: { enabled: true } })).status, 403);
      assert.equal((await request('/features/contentHistory', { token: adminToken, method: 'PATCH', body: { enabled: true } })).status, 403);
    });
    await t.test('actual signed activation is domain checked and becomes effective without another build', async () => {
      assert.equal((await request('/features/license', { token: adminToken, method: 'POST', body: { token: issue({ allowedHosts: ['elsewhere.test'] }) } })).status, 400);
      const activation = await request('/features/license', { token: adminToken, method: 'POST', body: { token: issue() } });
      assert.equal(activation.status, 200); assert.equal(activation.body.data.features.contentHistory.enabled, true);
      assert.equal(JSON.stringify(activation.body).includes('YUNSOFT-ENTITLEMENT+JWT'), false);
    });
    await t.test('native HTTP returns a consistent edit revision and rejects stale writes', async () => {
      const opened = await request(`/items/${collection}/${record.id}`, { token: editorToken, headers: { prefer: 'yuncms-edit-state' } });
      assert.equal(opened.status, 200); assert.equal(opened.body.meta.revision, '1');
      assert.equal(Object.hasOwn(opened.body.data, 'private_secret'), false);
      const saved = await request(`/items/${collection}/${record.id}`, { token: editorToken, method: 'PATCH',
        headers: { prefer: 'yuncms-edit-state', 'x-yuncms-item-revision': '1' }, body: { title: 'Reviewed' } });
      assert.equal(saved.status, 200); assert.equal(saved.body.meta.revision, '2');
      const stale = await request(`/items/${collection}/${record.id}`, { token: editorToken, method: 'PATCH',
        headers: { 'x-yuncms-item-revision': '1' }, body: { title: 'Lost update' } });
      assert.equal(stale.status, 409); assert.equal(stale.body.errors[0].code, 'ITEM_REVISION_CONFLICT');
      assert.equal((await items.readOne(record.id)).title, 'Reviewed');
    });
    await t.test('two actual MySQL writers cannot both commit the same expected revision', async () => {
      const results = await Promise.allSettled(['Winner A', 'Winner B'].map(title =>
        items.updateOne(record.id, { title }, { expectedRevision: '2' })));
      assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
      const rejected = results.find(result => result.status === 'rejected');
      assert.equal(rejected.reason.code, 'ITEM_REVISION_CONFLICT');
      assert.equal((await items.readEditState(record.id)).revision, '3');
    });
    await t.test('history omits secrets, remains admin restricted and restores through native mutations', async () => {
      const history = await revisions.readRevisions(record.id);
      assert.equal(history.length, 2);
      const previous = await revisions.readRevision(record.id, '2');
      assert.equal(previous.snapshot.title, 'Reviewed');
      assert.equal(Object.hasOwn(previous.snapshot, 'private_secret'), false);
      const editorRevisions = new ContentRevisionsService(collection, { ...options,
        accountability: createAccountability({ user: user.id, role: role.id }) });
      await assert.rejects(editorRevisions.readRevisions(record.id), { code: 'FORBIDDEN' });
      await revisions.restoreRevision(record.id, '2', { expectedRevision: '3' });
      const restored = await items.readOne(record.id);
      assert.equal(restored.title, 'Reviewed'); assert.equal(restored.private_secret, 'never snapshot this');
    });
    await t.test('rollback restores data, revision and history together', async () => {
      const before = await items.readEditState(record.id);
      await assert.rejects(withTransaction(database, async connection => {
        await new ItemsService(collection, { ...options, database: connection }).updateOne(record.id, { title: 'Rollback' }, { expectedRevision: before.revision });
        throw new Error('rollback fixture');
      }), /rollback fixture/);
      assert.equal((await items.readEditState(record.id)).revision, before.revision);
      assert.equal((await items.readOne(record.id)).title, 'Reviewed');
    });
    await t.test('disabled Premium never blocks native updates and bulk mutations still invalidate stale edits', async () => {
      await features.update('contentHistory', { enabled: false });
      await assert.rejects(revisions.readRevisions(record.id), { code: 'FEATURE_DISABLED' });
      const before = await items.readEditState(record.id);
      await items.updateMany({ id: { _eq: record.id } }, { title: 'Bulk update' });
      assert.equal(BigInt((await items.readEditState(record.id)).revision), BigInt(before.revision) + 1n);
      await assert.rejects(items.updateOne(record.id, { title: 'Stale after bulk' }, { expectedRevision: before.revision }), { code: 'ITEM_REVISION_CONFLICT' });
    });
    await t.test('an older read snapshot never pairs old data with a newer editable revision', async () => {
      const before = await items.readEditState(record.id);
      await withTransaction(database, async connection => {
        const reader = new ItemsService(collection, { ...options, database: connection });
        const original = await reader.readOne(record.id);
        await items.updateOne(record.id, { title: 'Changed after snapshot' }, { expectedRevision: before.revision });
        const state = await reader.readEditState(record.id);
        assert.equal(state.revision, before.revision);
        assert.equal((await reader.readOne(record.id)).title, original.title);
      }, { isolationLevel: 'REPEATABLE READ' });
      await assert.rejects(items.updateOne(record.id, { title: 'Stale snapshot' }, { expectedRevision: before.revision }), { code: 'ITEM_REVISION_CONFLICT' });
    });
    await t.test('preferred list metadata is native-RBAC filtered and cannot disclose unrelated revisions', async () => {
      const result = await request(`/items/${collection}?fields=id,title&limit=1`, { token: editorToken, headers: { prefer: 'yuncms-edit-state' } });
      assert.equal(result.status, 200); assert.equal(result.body.meta.primaryKey, 'id');
      assert.deepEqual(Object.keys(result.body.meta.revisions), [result.body.data[0].id]);
      const absent = await request(`/items/${collection}?filter=${encodeURIComponent(JSON.stringify({ id: { _eq: randomUUID() } }))}`, { token: editorToken, headers: { prefer: 'yuncms-edit-state' } });
      assert.deepEqual(absent.body.meta.revisions, {});
    });
    await t.test('tracking metadata survives unrelated schema edits and disabled-period writes invalidate old tokens', async () => {
      const before = await items.readEditState(record.id);
      await collections.updateOne(collection, { metadata: { displayTemplate: '{{ title }}' } });
      assert.equal((await items.readEditState(record.id)).revision, before.revision);
      await collections.updateOne(collection, { metadata: { contentTracking: { enabled: false, history: false } } });
      await items.updateOne(record.id, { title: 'While tracking UI disabled' });
      assert.equal((await items.readEditState(record.id)).revision, null);
      await assert.rejects(items.updateOne(record.id, { title: 'Invalid conditional write' }, { expectedRevision: before.revision }), { code: 'INVALID_ITEM_REVISION' });
      await collections.updateOne(collection, { metadata: { contentTracking: { enabled: true, history: false } } });
      await assert.rejects(items.updateOne(record.id, { title: 'Old token reused' }, { expectedRevision: before.revision }), { code: 'ITEM_REVISION_CONFLICT' });
      await assert.rejects(collections.updateOne(collection, { metadata: { contentTracking: { enabled: false, history: true } } }), { code: 'INVALID_SCHEMA_PAYLOAD' });
    });
    await t.test('preferred writes preserve native create-only access without acquiring read permission', async () => {
      const creatorRole = await new RolesService(options).createOne({ name: `Creator ${suffix}` }); extraRoles.push(creatorRole.id);
      const creator = await new UsersService(options).createOne({ email: `creator-${suffix}@example.test`, password: 'V2-creator-Test-9371!', role: creatorRole.id }); extraUsers.push(creator.id);
      await new PermissionsService(options).createOne({ role: creatorRole.id, collection, action: 'create', fields: ['title'] });
      const result = await request(`/items/${collection}`, { token: await login(creator, 'V2-creator-Test-9371!'), method: 'POST', body: { title: 'Create only' }, headers: { prefer: 'yuncms-edit-state' } });
      assert.equal(result.status, 201); assert.ok(result.body.data.id); assert.equal(result.body.meta, null);
      assert.equal((await items.readOne(result.body.data.id)).title, 'Create only');
    });
    await t.test('real nested saves retain confirmed IDs and revisions across a later child conflict and explicit resolution', async () => {
      const child = `v2_child_${suffix}`; childCollections.push(child);
      await collections.createOne({ collection: child });
      for (const [field, type] of [['parent_id', 'uuid'], ['title', 'string']]) await new FieldsService(options).createOne(child, { field, type });
      await new RelationsService(options).createM2O({ manyCollection: child, manyField: 'parent_id', oneCollection: collection, oneField: 'id' });
      const children = new ItemsService(child, options), existing = await children.createOne({ parent_id: record.id, title: 'Opened' });
      const opened = withEditState((await request(`/items/${child}/${existing.id}`, { token: adminToken, headers: { prefer: 'yuncms-edit-state' } })).body).data;
      await children.updateOne(existing.id, { title: 'Other editor' });
      const relation = { key: 'children', kind: 'o2m', childCollection: child, foreignKeyField: 'parent_id', primaryKey: 'id', editableFields: [{ field: 'title', type: 'string' }] };
      let progress = { existingRowsByKey: { children: [opened] }, draftState: { children: [
        { id: null, values: { title: 'Created before conflict' } }, { id: existing.id, values: { title: 'My draft' } },
      ] } };
      const nativeRequest = async (path, options = {}) => {
        const result = await request(path, { ...options, token: adminToken });
        if (result.status >= 400) throw Object.assign(new Error(result.body.errors[0].message), { code: result.body.errors[0].code });
        return result.body;
      };
      const save = () => saveNestedRelations({ parentId: record.id, nestedRelations: [relation], ...progress, request: nativeRequest, onProgress: next => { progress = next; } });
      await assert.rejects(save(), { code: 'ITEM_REVISION_CONFLICT' });
      const createdId = progress.draftState.children[0].id;
      assert.ok(createdId); assert.equal(progress.draftState.children[1].values.title, 'My draft');
      await assert.rejects(save(), { code: 'ITEM_REVISION_CONFLICT' });
      assert.equal(progress.draftState.children[0].id, createdId);
      assert.equal((await children.readMany()).length, 2);
      const fresh = withEditState((await request(`/items/${child}/${existing.id}`, { token: adminToken, headers: { prefer: 'yuncms-edit-state' } })).body).data;
      progress.existingRowsByKey.children = [...progress.existingRowsByKey.children.filter(row => row.id !== existing.id), fresh];
      progress.draftState.children[1].values.title = 'Explicitly resolved';
      await save();
      assert.equal((await children.readMany()).length, 2);
      assert.equal((await children.readOne(existing.id)).title, 'Explicitly resolved');
    });
    await t.test('a preferred page above 100 records preserves the native filter bound and includes all authorized revisions', async () => {
      const many = await items.createMany(Array.from({ length: 121 }, (_, index) => ({ title: `Paged revision ${index}` })));
      const states = await items.readEditStates(many.map(row => row.id));
      assert.equal(Object.keys(states).length, 121);
      assert.ok(Object.values(states).every(value => value === '1'));
      const response = await request(`/items/${collection}?fields=id,title&limit=200`, { token: editorToken, headers: { prefer: 'yuncms-edit-state' } });
      assert.equal(response.status, 200);
      assert.equal(Object.keys(response.body.meta.revisions).length, response.body.data.length);
      assert.ok(response.body.data.length > 100);
    });
    await t.test('new native M2M junctions receive the same tracking default and reject stale relationship deletion', async () => {
      const junction = `v2_link_${suffix}`; junctionCollections.push(junction);
      const child = childCollections[0], related = (await new ItemsService(child, options).readMany())[0];
      await new RelationsService(options).createM2M({ junctionCollection: junction, leftCollection: collection, rightCollection: child, leftField: 'parent_id', rightField: 'child_id' });
      assert.deepEqual((await collections.readOne(junction)).metadata.contentTracking, { enabled: true, history: false });
      const links = new ItemsService(junction, options);
      const link = await links.createOne({ parent_id: record.id, child_id: related.id });
      const state = await links.readEditState(link.id); assert.equal(state.revision, '1');
      await links.updateOne(link.id, { child_id: related.id }, { expectedRevision: state.revision });
      await assert.rejects(links.deleteOne(link.id, { expectedRevision: state.revision }), { code: 'ITEM_REVISION_CONFLICT' });
      assert.ok(await links.readOne(link.id));
    });
    await t.test('feature disabling reaches real HTTP entry points and native script execution', async () => {
      assert.equal((await request('/ai/status', { token: adminToken })).status, 200);
      for (const name of ['aiAssistant', 'aiFlows', 'mcp', 'flowScripts']) await features.update(name, { enabled: false });
      assert.equal((await request('/ai/status', { token: adminToken })).status, 403);
      assert.equal((await request('/mcp', { token: adminToken, method: 'POST', body: {} })).status, 403);
      const automation = new AiAutomationsService({ ...options, services: createCoreServiceRegistry().toObject() });
      await assert.rejects(automation.executionOptions({ run_as: user.id }), { code: 'FEATURE_DISABLED' });
      const manager = new FlowsService({ ...options, accountability: createAccountability({ user: adminUser.id, role: adminRole.id, admin: true }), scripts: { enabled: true } });
      const flow = await manager.save({ name: `Feature gate ${suffix}`, status: 'inactive', trigger: 'manual', accountability: 'trigger',
        options: { response: '$last' }, entry: 'script', operations: [{ id: 'script', key: 'script', type: 'script', options: { format: 'module', code: 'export default () => 42' } }] });
      flowIds.push(flow.id);
      const active = await manager.save({ ...flow, status: 'active' }, flow.id);
      await assert.rejects(manager.runManual(active.id), { code: 'FEATURE_DISABLED' });
      await features.update('flowScripts', { enabled: true });
      assert.equal((await manager.runManual(active.id)).output, 42);
      const denied = new FeaturesService({ ...options, featurePolicy: createFeaturePolicy({ ...featureConfig, disabled: ['flowScripts'] }) });
      await assert.rejects(denied.update('flowScripts', { enabled: true }), { code: 'FEATURE_DISABLED' });
    });

    await t.test('history restore preserves native current-user defaults and server-managed timestamps and actors', async () => {
      await features.update('contentHistory', { enabled: true });
      const actorCollection = `v2_actor_${suffix}`;
      await collections.createOne({ collection: actorCollection, systemFields: ['created_at', 'updated_at', 'created_by', 'updated_by'],
        metadata: { contentTracking: { enabled: true, history: true } } });
      childCollections.push(actorCollection);
      const fields = new FieldsService(options);
      await fields.createOne(actorCollection, { field: 'title', type: 'string' });
      await fields.createOne(actorCollection, { field: 'owner', type: 'uuid', defaultPreset: 'current_user' });
      const actorItems = new ItemsService(actorCollection, { ...options, accountability: createAccountability({ user: adminUser.id, role: adminRole.id, admin: true }) });
      const initial = await actorItems.createOne({ title: 'Original with native defaults' });
      await actorItems.updateOne(initial.id, { title: 'New value' });
      const restored = await request(`/items/${actorCollection}/${initial.id}/revisions/1/restore`, {
        token: adminToken, method: 'POST', headers: { 'x-yuncms-item-revision': '2' },
      });
      assert.equal(restored.status, 200, JSON.stringify(restored.body));
      assert.equal(restored.body.data.title, initial.title);
      assert.equal(restored.body.data.owner, adminUser.id);
      assert.equal(restored.body.data.created_by, adminUser.id);
      assert.equal(new Date(restored.body.data.created_at).getTime(), new Date(initial.created_at).getTime());
      assert.equal((await actorItems.readEditState(initial.id)).revision, '3');
    });

  } finally {
    if (server) await new Promise(resolve => server.close(resolve));
    try {
      if (priorLicense) {
        await database.query('DELETE FROM yuncms_license_state WHERE id = 1');
        for (const row of priorLicense) await database.query('INSERT INTO yuncms_license_state (id, token, updated_by, updated_at) VALUES (?, ?, ?, ?)', [row.id, row.token, row.updated_by, row.updated_at]);
      }
      if (priorSettings) {
        await database.query('DELETE FROM yuncms_feature_settings');
        for (const row of priorSettings) await database.query('INSERT INTO yuncms_feature_settings (feature, enabled, updated_by, updated_at) VALUES (?, ?, ?, ?)', [row.feature, row.enabled, row.updated_by, row.updated_at]);
      }
      for (const id of flowIds) await database.query('DELETE FROM yuncms_flows WHERE id = ?', [id]);
      for (const junction of junctionCollections) {
        for (const field of ['parent_id', 'child_id']) if (await new RelationsService(options).readOne(junction, field)) await new RelationsService(options).deleteM2O(junction, field);
        await collections.deleteOne(junction, { destructive: true });
      }
      for (const child of childCollections) {
        if (await new RelationsService(options).readOne(child, 'parent_id')) await new RelationsService(options).deleteM2O(child, 'parent_id');
        await collections.deleteOne(child, { destructive: true });
      }
      for (const id of extraUsers) await new UsersService(options).deleteOne(id);
      for (const id of extraRoles) await new RolesService(options).deleteOne(id);
      await collections.deleteOne(collection, { destructive: true }).catch(() => {});
      for (const account of [user, adminUser]) if (account) await new UsersService(options).deleteOne(account.id);
      if (role) await new RolesService(options).deleteOne(role.id);
      // The native API deliberately prevents deletion of administrator roles.
      if (adminRole) await database.query('DELETE FROM yuncms_roles WHERE id = ? AND name = ?', [adminRole.id, `V2 admin ${suffix}`]);
    } finally { await closeDatabasePool(database); }
  }
});
