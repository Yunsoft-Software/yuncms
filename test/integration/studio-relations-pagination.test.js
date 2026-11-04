import assert from 'node:assert/strict';
import test from 'node:test';
import { bootstrapDatabase, createCoreServiceRegistry, createDatabasePool, createSystemAccountability, loadConfig, RolesService, SchemaCache, UsersService } from '@yunsoft/yuncms-core';
import { createApp } from '../../packages/api/src/app.js';
import { loadRelationLookup } from '../../apps/studio/src/content-access.js';
import { buildInitialNestedDraft, discoverNestedRelations, loadNestedRecordRows, loadNestedSummariesForItems, saveNestedRelations, searchNestedParentIds } from '../../apps/studio/src/content-relations.js';
import { readAllStudioPages } from '../../apps/studio/src/paged-data.js';
import { seedStudioLayout, cleanupStudioLayout } from '../helpers/studio-layout-fixture.mjs';

test('native MySQL/HTTP Studio relation loading spans every page, preserves 520 links and detects concurrent membership changes', { skip: process.env.YUNCMS_TEST_MYSQL !== '1', timeout: 240000 }, async () => {
  const config = loadConfig({ ...process.env, API_RATE_LIMIT_MAX: '20000' });
  assert.equal(process.env.YUNCMS_TEST_DB_ALLOW_DESTRUCTIVE, '1'); assert.match(config.database.database, /test|ci|dev/i);
  const pool = createDatabasePool(config.database), accountability = createSystemAccountability();
  const suffix = crypto.randomUUID().replaceAll('-', '').slice(0, 10);
  let server, role, user, fixture, send;
  try {
    await bootstrapDatabase(pool);
    role = await new RolesService({ database: pool, accountability }).createOne({ name: `Paged Studio ${suffix}`, admin: true });
    const password = `Paged-native-${suffix}!`;
    user = await new UsersService({ database: pool, accountability }).createOne({ email: `paged-${suffix}@example.test`, password, role: role.id });
    const app = createApp({ pool, config, schemaCache: new SchemaCache(), serviceRegistry: createCoreServiceRegistry() });
    server = await new Promise(resolve => { const value = app.listen(0, '127.0.0.1', () => resolve(value)); });
    const base = `http://127.0.0.1:${server.address().port}`;
    const login = await fetch(base + '/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: user.email, password }) });
    assert.equal(login.status, 200); const session = (await login.json()).data;
    const requests = [];
    async function request(path, { method = 'GET', body } = {}) {
      requests.push({ path, method });
      const response = await fetch(base + path, { method, headers: { 'content-type': 'application/json', authorization: `Bearer ${session.access_token}` }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
      if (response.status === 204) return null;
      const result = await response.json(); assert.ok(response.ok, `${method} ${path}: ${JSON.stringify(result)}`); return result;
    }
    send = async (path, options) => (await request(path, options))?.data ?? null;
    fixture = await seedStudioLayout(send, suffix);
    const relations = await send('/schema/relations');
    const nested = await discoverNestedRelations(fixture.parent, relations, { isAdmin: true, request, locale: 'en' });
    const many = nested.find(relation => relation.kind === 'm2m');
    assert.ok(many); assert.equal(many.lookup.items.length, 520);
    const loaded = await loadNestedRecordRows(nested, fixture.article.id, { request });
    assert.equal(loaded[many.key].length, 520);
    const summary = await loadNestedSummariesForItems(nested, [fixture.article], { request });
    assert.equal(summary[many.key][fixture.article.id].length, 520);
    const draft = buildInitialNestedDraft(nested, loaded);
    await saveNestedRelations({ nestedRelations: [many], parentId: fixture.article.id, existingRowsByKey: loaded, draftState: draft, request });
    assert.equal((await loadNestedRecordRows([many], fixture.article.id, { request }))[many.key].length, 520);
    const filter = encodeURIComponent(JSON.stringify({ [many.sourceJunctionField]: { _eq: fixture.article.id } }));
    const read = await request(`/items/${fixture.junction}?filter=${filter}&limit=1`);
    assert.equal(read.meta.total_count, 520);
    assert.ok(requests.some(entry => entry.path.includes('offset=400')));
    const publicRequest = async path => {
      const response = await fetch(base + path), result = await response.json();
      if (!response.ok) throw Object.assign(new Error(result.errors[0].message), { status: response.status });
      return result;
    };
    await assert.rejects(loadNestedRecordRows(nested, fixture.article.id, { request: publicRequest }), { status: 403 });
    assert.equal((await request(`/items/${fixture.junction}?filter=${filter}&limit=1`)).meta.total_count, 520);

    const [, lookup] = await loadRelationLookup({ one_collection: fixture.tags, one_field: 'id', many_field: 'topic_id' }, { isAdmin: true, request });
    assert.equal(lookup.items.length, 520);
    const needle = `page-search-${suffix}`;
    for (let i = 0; i < 205; i++) {
      const parent = await send(`/items/${fixture.parent}`, { method: 'POST', body: { title: `${needle}-${i}` } });
      await send(`/items/${fixture.child}`, { method: 'POST', body: { article_id: parent.id, language_code: 'en-US', title: `${needle}-${i}` } });
    }
    assert.equal((await searchNestedParentIds(nested, needle, { request })).length, 205);

    let inserted = false;
    const concurrentRequest = async path => {
      const result = await request(path);
      if (!inserted) { inserted = true; await send(`/items/${fixture.tags}`, { method: 'POST', body: { name: 'Concurrent real API insertion' } }); }
      return result;
    };
    await assert.rejects(readAllStudioPages(`/items/${fixture.tags}`, { request: concurrentRequest }), { code: 'STUDIO_PAGINATION_CHANGED' });
  } finally {
    if (fixture) await cleanupStudioLayout(send, fixture);
    if (server) await new Promise(resolve => server.close(resolve));
    if (user) await pool.query('DELETE FROM yuncms_users WHERE id = ?', [user.id]);
    if (role) await pool.query('DELETE FROM yuncms_roles WHERE id = ?', [role.id]);
    await pool.end();
  }
});
