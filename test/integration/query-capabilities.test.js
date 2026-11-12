import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';

import {
  bootstrapDatabase,
  closeDatabasePool,
  CollectionsService,
  createAccountability,
  createCoreServiceRegistry,
  createDatabasePool,
  createPublicAccountability,
  createSystemAccountability,
   ensurePublicRole,
  FieldsService,
  ItemsService,
  loadConfig,
  PermissionsService,
  quoteIdentifier,
  readManyWithRelations,
  RelationsService,
  RolesService,
  SchemaCache,
  UsersService,
} from '@yunsoft/yuncms-core';
import { createApp } from '../../packages/api/src/app.js';

const ENABLED = process.env.YUNCMS_TEST_MYSQL === '1';
const DESTRUCTIVE = process.env.YUNCMS_TEST_DB_ALLOW_DESTRUCTIVE === '1';

function requireDisposableDatabase(config) {
  if (!DESTRUCTIVE) throw new Error('YUNCMS_TEST_DB_ALLOW_DESTRUCTIVE=1 is required');
  if (!/(test|ci|dev)/i.test(config.database.database)) {
    throw new Error(`Integration DB name must contain test, ci or dev: ${config.database.database}`);
  }
}

function suffix() {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`.slice(-9);
}

test('real MySQL accepts ISO datetime filters for reads and strict bulk mutations with RBAC', {
  skip: !ENABLED, timeout: 30_000,
}, async () => {
  const config = loadConfig(process.env);
  requireDisposableDatabase(config);
  const pool = createDatabasePool(config.database);
  const collection = `it_dates_${suffix()}`;
  const options = { database: pool, accountability: createSystemAccountability(), schemaCache: new SchemaCache({ versionCheckTtlMs: 0 }) };
  const collections = new CollectionsService(options);
  const fields = new FieldsService(options);
  const roles = new RolesService(options);
  const permissions = new PermissionsService(options);
  let roleId;
  try {
    await bootstrapDatabase(pool);
    await collections.createOne({ collection, systemFields: ['created_at'] });
    for (const definition of [{ field: 'at', type: 'datetime' }, { field: 'ts', type: 'timestamp' }, { field: 'status', type: 'string' }]) {
      await fields.createOne(collection, definition);
    }
    const items = new ItemsService(collection, options);
    const iso = '2026-08-20T04:56:17.687Z';
    const allowed = await items.createOne({ at: iso, ts: iso, status: 'allowed' });
    const hidden = await items.createOne({ at: iso, ts: iso, status: 'hidden' });
    const role = await roles.createOne({ name: `Datetime role ${collection}` });
    roleId = role.id;
    for (const action of ['read', 'update', 'delete']) {
      await permissions.createOne({ role: roleId, collection, action, fields: ['id', 'at', 'ts', 'status', 'created_at'], filter: { status: { _eq: 'allowed' } } });
    }
    const restricted = new ItemsService(collection, { ...options, accountability: createAccountability({ user: 'datetime-user', role: roleId }) });
    for (const field of ['at', 'ts']) {
      const rows = await restricted.readMany({ filter: { [field]: { _in: ['2026-08-20T07:56:17.687+03:00'] } } });
      assert.deepEqual(rows.map((row) => row.id), [allowed.id]);
    }
    await restricted.updateMany({ at: { _lt: '2026-08-31T04:56:17.687Z' } }, { ts: '2026-08-21T04:56:17.687Z' });
    const deleted = await restricted.deleteMany({ _and: [{ at: { _lt: '2026-08-31T04:56:17.687Z' } }, { ts: { _nin: [iso] } }, { created_at: { _lt: '2099-01-01T00:00:00Z' } }] });
    assert.equal(deleted, 1);
    assert.deepEqual((await items.readMany()).map((row) => row.id), [hidden.id]);
    await assert.rejects(items.deleteMany({ at: { _lt: '2026-02-30T00:00:00Z' } }), (error) => error.code === 'INVALID_QUERY');
    assert.equal((await items.readMany()).length, 1);
  } finally {
    const cleanupErrors = [];
    if (roleId) {
      try {
        await pool.query('DELETE FROM yuncms_permissions WHERE role = ?', [roleId]);
      } catch (error) {
        cleanupErrors.push(error);
      }
    }
    if (roleId) {
      try {
        await roles.deleteOne(roleId);
      } catch (error) {
        cleanupErrors.push(error);
      }
    }
    try {
      await collections.deleteOne(collection, { destructive: true });
    } catch (error) {
      cleanupErrors.push(error);
    }
    try {
      await closeDatabasePool(pool);
    } catch (error) {
      cleanupErrors.push(error);
    }
    if (cleanupErrors.length > 0) {
      if (cleanupErrors.length === 1) throw cleanupErrors[0];
      throw new AggregateError(cleanupErrors, `Cleanup failed with ${cleanupErrors.length} error(s)`);
    }
  }
});

test('real MySQL enforces deep, reverse, M2M and advanced-query RBAC boundaries', {
  skip: !ENABLED,
  timeout: 90_000,
}, async () => {
  const config = loadConfig(process.env);
  requireDisposableDatabase(config);
  const pool = createDatabasePool(config.database);
  const token = suffix();
  const names = {
    countries: `it_country_${token}`,
    companies: `it_company_${token}`,
    authors: `it_author_${token}`,
    articles: `it_article_${token}`,
    comments: `it_comment_${token}`,
    tags: `it_tag_${token}`,
    junction: `it_link_${token}`,
  };
  const collectionsInDependencyOrder = [
    names.countries,
    names.companies,
    names.authors,
    names.articles,
    names.comments,
    names.tags,
  ];
  const system = createSystemAccountability();
  const schemaCache = new SchemaCache({ versionCheckTtlMs: 0 });
  const collections = new CollectionsService({ accountability: system, database: pool });
  const fields = new FieldsService({ accountability: system, database: pool });
  const relations = new RelationsService({ accountability: system, database: pool });
  const roles = new RolesService({ accountability: system, database: pool });
  const permissions = new PermissionsService({
    accountability: system,
    database: pool,
    schemaCache,
  });
  let roleId = null;

  const createItem = (collection, payload) => new ItemsService(collection, {
    accountability: system,
    database: pool,
    schemaCache,
  }).createOne(payload);

  try {
    await bootstrapDatabase(pool);
    for (const collection of collectionsInDependencyOrder) {
      await collections.createOne({ collection });
    }

    const fieldDefinitions = new Map([
      [names.countries, [
        { field: 'name', type: 'string', required: true },
        { field: 'code', type: 'string', required: true },
      ]],
      [names.companies, [
        { field: 'name', type: 'string', required: true },
        { field: 'country_id', type: 'uuid', required: false },
      ]],
      [names.authors, [
        { field: 'name', type: 'string', required: true },
        { field: 'visibility', type: 'string', required: true },
        { field: 'company_id', type: 'uuid', required: false },
      ]],
      [names.articles, [
        { field: 'title', type: 'string', required: true },
        { field: 'status', type: 'string', required: true },
        { field: 'author_id', type: 'uuid', required: false },
      ]],
      [names.comments, [
        { field: 'text', type: 'string', required: true },
        { field: 'status', type: 'string', required: true },
        { field: 'article_id', type: 'uuid', required: false },
      ]],
      [names.tags, [
        { field: 'name', type: 'string', required: true },
        { field: 'visible', type: 'boolean', required: true },
      ]],
    ]);
    for (const [collection, definitions] of fieldDefinitions) {
      for (const definition of definitions) await fields.createOne(collection, definition);
    }

    for (const relation of [
      { manyCollection: names.companies, manyField: 'country_id', oneCollection: names.countries },
      { manyCollection: names.authors, manyField: 'company_id', oneCollection: names.companies },
      { manyCollection: names.articles, manyField: 'author_id', oneCollection: names.authors },
      { manyCollection: names.comments, manyField: 'article_id', oneCollection: names.articles },
    ]) {
      await relations.createM2O({ ...relation, onDelete: 'SET NULL' });
    }
    const m2m = await relations.createM2M({
      junctionCollection: names.junction,
      leftCollection: names.articles,
      rightCollection: names.tags,
    });
    schemaCache.clear();

    const turkey = await createItem(names.countries, { name: 'Türkiye', code: 'TR' });
    const usa = await createItem(names.countries, { name: 'United States', code: 'US' });
    const localCompany = await createItem(names.companies, { name: 'Yunsoft', country_id: turkey.id });
    const foreignCompany = await createItem(names.companies, { name: 'Hidden Corp', country_id: usa.id });
    const publicAuthor = await createItem(names.authors, {
      name: 'Ada', visibility: 'public', company_id: localCompany.id,
    });
    const privateAuthor = await createItem(names.authors, {
      name: 'Private', visibility: 'private', company_id: foreignCompany.id,
    });
    const publicArticle = await createItem(names.articles, {
      title: 'Visible public', status: 'published', author_id: publicAuthor.id,
    });
    await createItem(names.articles, {
      title: 'Visible private', status: 'published', author_id: privateAuthor.id,
    });
    await createItem(names.articles, {
      title: 'Visible draft', status: 'draft', author_id: publicAuthor.id,
    });
    await createItem(names.comments, {
      text: 'Allowed comment', status: 'visible', article_id: publicArticle.id,
    });
    await createItem(names.comments, {
      text: 'Hidden comment', status: 'hidden', article_id: publicArticle.id,
    });
    const visibleTag = await createItem(names.tags, { name: 'Allowed tag', visible: true });
    const hiddenTag = await createItem(names.tags, { name: 'Hidden tag', visible: false });
    await createItem(names.junction, {
      [m2m.leftField]: publicArticle.id,
      [m2m.rightField]: visibleTag.id,
    });
    await createItem(names.junction, {
      [m2m.leftField]: publicArticle.id,
      [m2m.rightField]: hiddenTag.id,
    });

    const role = await roles.createOne({ name: `Query Reader ${token}` });
    roleId = role.id;
    const grants = [
      {
        collection: names.articles,
        fields: ['id', 'title', 'status', 'author_id'],
        filter: { status: { _eq: 'published' } },
      },
      {
        collection: names.authors,
        fields: ['id', 'name', 'company_id'],
        filter: { visibility: { _eq: 'public' } },
      },
      { collection: names.companies, fields: ['id', 'name', 'country_id'] },
      {
        collection: names.countries,
        fields: ['id', 'name'],
        filter: { code: { _eq: 'TR' } },
      },
      {
        collection: names.comments,
        fields: ['id', 'article_id', 'text'],
        filter: { status: { _eq: 'visible' } },
      },
      {
        collection: names.tags,
        fields: ['id', 'name'],
        filter: { visible: { _eq: true } },
      },
    ];
    for (const grant of grants) {
      await permissions.createOne({ role: roleId, action: 'read', ...grant });
    }

    const accountability = createAccountability({ user: `query-reader-${token}`, role: roleId });
    const options = { accountability, database: pool, schemaCache };
    const relationFields = [
      'title',
      'author_id.name',
      'author_id.company_id.name',
      'author_id.company_id.country_id.name',
      `${names.comments}.text`,
      `${names.tags}.name`,
    ];

    await assert.rejects(
      readManyWithRelations({
        collection: names.articles,
        query: { fields: relationFields, sort: 'title' },
        options,
      }),
      (error) => error.code === 'FORBIDDEN',
    );

    await permissions.createOne({
      role: roleId,
      collection: names.junction,
      action: 'read',
      fields: ['id'],
    });

    const expanded = await readManyWithRelations({
      collection: names.articles,
      query: { fields: relationFields, sort: 'title' },
      options,
    });
    assert.equal(expanded.data.length, 2);
    const visible = expanded.data.find((row) => row.title === 'Visible public');
    const targetFiltered = expanded.data.find((row) => row.title === 'Visible private');
    assert.deepEqual(visible.author_id, {
      name: 'Ada',
      company_id: { name: 'Yunsoft', country_id: { name: 'Türkiye' } },
    });
    assert.deepEqual(visible[names.comments], [{ text: 'Allowed comment' }]);
    assert.deepEqual(visible[names.tags], [{ name: 'Allowed tag' }]);
    assert.equal(Object.hasOwn(visible, names.junction), false);
    assert.equal(targetFiltered.author_id, null);

    await assert.rejects(
      readManyWithRelations({
        collection: names.articles,
        query: { fields: `author_id.company_id.country_id.code` },
        options,
      }),
      (error) => error.code === 'INVALID_QUERY',
    );

    const readerItems = new ItemsService(names.articles, options);
    const searched = await readerItems.readManyWithMeta({
      fields: ['id', 'title'],
      search: 'Visible',
      sort: 'title',
    });
    assert.deepEqual(searched.data.map((row) => row.title), ['Visible private', 'Visible public']);
    const grouped = await readerItems.readManyWithMeta({
      aggregate: { count: '*' },
      groupBy: 'status',
    });
    assert.deepEqual(grouped.data.map((row) => ({ status: row.status, count: Number(row.count) })), [
      { status: 'published', count: 2 },
    ]);

    const costlyFields = [
      ...Array.from({ length: 95 }, () => 'title'),
      'author_id.name',
      'author_id.company_id.name',
      'author_id.company_id.country_id.name',
      `${names.comments}.text`,
      `${names.tags}.name`,
    ];
    await assert.rejects(
      readManyWithRelations({
        collection: names.articles,
        query: {
          fields: costlyFields,
          sort: Array.from({ length: 20 }, () => 'title'),
          limit: 500,
          search: 'Visible',
          aggregate: { count: Array.from({ length: 20 }, () => '*') },
        },
        options,
      }),
      (error) => error.code === 'QUERY_COST_LIMIT',
    );

    const commentTable = quoteIdentifier(names.comments, 'comment integration table');
    const rowCount = 2_000;
    const placeholders = Array.from({ length: rowCount }, () => '(?, ?, ?, ?)').join(', ');
    const values = [];
    for (let index = 0; index < rowCount; index += 1) {
      values.push(randomUUID(), `Bulk ${index}`, 'visible', publicArticle.id);
    }
    await pool.query(
      `INSERT INTO ${commentTable} (id, text, status, article_id) VALUES ${placeholders}`,
      values,
    );
    await assert.rejects(
      readManyWithRelations({
        collection: names.articles,
        query: { fields: `title,${names.comments}.text` },
        options,
      }),
      (error) => error.code === 'QUERY_RELATION_ROW_LIMIT',
    );
  } finally {
    if (roleId) await pool.query('DELETE FROM yuncms_permissions WHERE role = ?', [roleId]).catch(() => {});
    if (roleId) await pool.query('DELETE FROM yuncms_roles WHERE id = ?', [roleId]).catch(() => {});
    const allCollections = [names.junction, ...collectionsInDependencyOrder.toReversed()];
    await pool.query('SET FOREIGN_KEY_CHECKS = 0').catch(() => {});
    for (const collection of allCollections) {
      const table = quoteIdentifier(collection, 'integration cleanup table');
      await pool.query(`DROP TABLE IF EXISTS ${table}`).catch(() => {});
    }
    await pool.query('SET FOREIGN_KEY_CHECKS = 1').catch(() => {});
    await pool.query(
      `DELETE FROM yuncms_relations
       WHERE many_collection IN (?) OR one_collection IN (?) OR junction_collection IN (?)`,
      [allCollections, allCollections, allCollections],
    ).catch(() => {});
    await pool.query('DELETE FROM yuncms_collections WHERE collection IN (?)', [allCollections]).catch(() => {});
    await closeDatabasePool(pool).catch(() => {});
  }
});

test('real MySQL and HTTP enforce M2O relational filters across permissions, caller queries, writes and schema changes (#122)', {
  skip: !ENABLED,
  timeout: 90_000,
}, async () => {
  const config = loadConfig(process.env);
  requireDisposableDatabase(config);
  const pool = createDatabasePool(config.database);
  const token = suffix();
  const names = {
    articles: `it_m2o_art_${token}`,
    translations: `it_m2o_tr_${token}`,
    notes: `it_m2o_note_${token}`,
    categories: `it_m2o_cat_${token}`,
  };
  const system = createSystemAccountability();
  const sharedSchemaCache = new SchemaCache();
  const baseOptions = { accountability: system, database: pool, schemaCache: sharedSchemaCache };
  const collections = new CollectionsService(baseOptions);
  const fields = new FieldsService(baseOptions);
  const relations = new RelationsService(baseOptions);
  const roles = new RolesService(baseOptions);
  const permissions = new PermissionsService(baseOptions);
  const users = new UsersService(baseOptions);

  let server = null;
  const createdRoleIds = [];
  const createdUserIds = [];
  const createdPermIds = [];

  try {
    await bootstrapDatabase(pool);
    const publicRole = await ensurePublicRole(pool);

    for (const collection of [names.articles, names.translations, names.notes, names.categories]) {
      await collections.createOne({ collection });
    }

    for (const def of [
      { field: 'status', type: 'string', required: true },
      { field: 'secret_notes', type: 'string', required: false },
      { field: 'badge', type: 'string', required: false },
    ]) await fields.createOne(names.articles, def);

    for (const def of [
      { field: 'articles_id', type: 'uuid', required: false },
      { field: 'languages_code', type: 'string', required: true },
      { field: 'slug', type: 'string', required: true },
      { field: 'title', type: 'string', required: true },
    ]) await fields.createOne(names.translations, def);

    for (const def of [
      { field: 'articles_id', type: 'uuid', required: false },
      { field: 'body', type: 'string', required: true },
    ]) await fields.createOne(names.notes, def);

    for (const def of [
      { field: 'parent_id', type: 'uuid', required: false },
      { field: 'status', type: 'string', required: true },
      { field: 'label', type: 'string', required: true },
    ]) await fields.createOne(names.categories, def);

    await relations.createM2O({
      manyCollection: names.translations,
      manyField: 'articles_id',
      oneCollection: names.articles,
      onDelete: 'SET NULL',
    });
    await relations.createM2O({
      manyCollection: names.notes,
      manyField: 'articles_id',
      oneCollection: names.articles,
      onDelete: 'SET NULL',
    });
    await relations.createM2O({
      manyCollection: names.categories,
      manyField: 'parent_id',
      oneCollection: names.categories,
      onDelete: 'SET NULL',
    });

    const sysArticles = new ItemsService(names.articles, baseOptions);
    const sysTranslations = new ItemsService(names.translations, baseOptions);
    const sysNotes = new ItemsService(names.notes, baseOptions);
    const sysCategories = new ItemsService(names.categories, baseOptions);

    const publishedArticle = await sysArticles.createOne({
      status: 'published',
      secret_notes: 'top-secret-published',
      badge: 'featured',
    });
    const draftArticle = await sysArticles.createOne({
      status: 'draft',
      secret_notes: 'top-secret-draft',
      badge: 'featured',
    });

    const pubTr = await sysTranslations.createOne({
      articles_id: publishedArticle.id,
      languages_code: 'tr',
      slug: 'yayinda-tr',
      title: 'Yayinda TR',
    });
    const pubEn = await sysTranslations.createOne({
      articles_id: publishedArticle.id,
      languages_code: 'en',
      slug: 'published-en',
      title: 'Published EN',
    });
    const draftTr = await sysTranslations.createOne({
      articles_id: draftArticle.id,
      languages_code: 'tr',
      slug: 'taslak-tr',
      title: 'Taslak TR',
    });
    const draftEn = await sysTranslations.createOne({
      articles_id: draftArticle.id,
      languages_code: 'en',
      slug: 'draft-en',
      title: 'Draft EN',
    });

    await sysNotes.createOne({ articles_id: publishedArticle.id, body: 'Public parent note' });
    await sysNotes.createOne({ articles_id: draftArticle.id, body: 'Draft parent note' });

    const pubArticlePerm = await permissions.createOne({
      role: publicRole.id,
      collection: names.articles,
      action: 'read',
      fields: ['id', 'status'],
      filter: { status: { _eq: 'published' } },
    });
    const pubTranslationPerm = await permissions.createOne({
      role: publicRole.id,
      collection: names.translations,
      action: 'read',
      fields: ['id', 'articles_id', 'languages_code', 'slug', 'title'],
      filter: { articles_id: { status: { _eq: 'published' } } },
    });
    const pubNotesPerm = await permissions.createOne({
      role: publicRole.id,
      collection: names.notes,
      action: 'read',
      fields: ['id', 'articles_id', 'body'],
      filter: null,
    });
    createdPermIds.push(pubArticlePerm.id, pubTranslationPerm.id, pubNotesPerm.id);

    const app = createApp({
      pool,
      config,
      schemaCache: sharedSchemaCache,
      serviceRegistry: createCoreServiceRegistry(),
    });
    server = await new Promise((resolve) => {
      const listening = app.listen(0, '127.0.0.1', () => resolve(listening));
    });
    const origin = `http://127.0.0.1:${server.address().port}`;

    // 1. Issue #122 anonymous Public reads: parent + reverse expansion, collection list, and direct item read.
    const expandedArticlesRes = await fetch(
      `${origin}/items/${names.articles}?fields=${encodeURIComponent(`id,${names.translations}.*`)}`,
    );
    assert.equal(expandedArticlesRes.status, 200);
    const expandedArticles = (await expandedArticlesRes.json()).data;
    assert.equal(expandedArticles.length, 1);
    assert.equal(expandedArticles[0].id, publishedArticle.id);
    assert.deepEqual(
      expandedArticles[0][names.translations].map((row) => row.slug).sort(),
      ['published-en', 'yayinda-tr'],
    );

    const publicListRes = await fetch(`${origin}/items/${names.translations}?sort=slug`);
    assert.equal(publicListRes.status, 200);
    const publicList = await publicListRes.json();
    assert.deepEqual(publicList.data.map((row) => row.id), [pubEn.id, pubTr.id]);
    assert.equal(publicList.meta.total_count, 2);

    assert.equal((await fetch(`${origin}/items/${names.translations}/${pubTr.id}`)).status, 200);
    assert.equal((await fetch(`${origin}/items/${names.translations}/${draftTr.id}`)).status, 404);

    // 2. Caller userFilter authorization boundaries (positive + negative field/row/collection isolation).
    const positiveCallerFilter = encodeURIComponent(
      JSON.stringify({ articles_id: { status: { _eq: 'published' } }, languages_code: { _eq: 'tr' } }),
    );
    const positiveCallerRes = await fetch(`${origin}/items/${names.translations}?filter=${positiveCallerFilter}`);
    assert.equal(positiveCallerRes.status, 200);
    assert.deepEqual((await positiveCallerRes.json()).data.map((row) => row.id), [pubTr.id]);

    const secretFieldFilter = encodeURIComponent(
      JSON.stringify({ articles_id: { secret_notes: { _contains: 'top-secret' } } }),
    );
    const secretFieldRes = await fetch(`${origin}/items/${names.translations}?filter=${secretFieldFilter}`);
    assert.equal(secretFieldRes.status, 400);
    assert.equal((await secretFieldRes.json()).errors?.[0]?.code, 'INVALID_QUERY');

    // Deep and wide relational/logical filters are rejected with 400 INVALID_QUERY (never 500 or unbounded pre-scan).
    let deepHttpFilter = { articles_id: { status: { _eq: 'published' } } };
    for (let index = 0; index < 60; index += 1) deepHttpFilter = { _and: [deepHttpFilter] };
    let deepScalarHttp = 'published';
    for (let index = 0; index < 40; index += 1) deepScalarHttp = [deepScalarHttp];
    const wideHttpFilter = {
      _or: Array.from({ length: 120 }, (_, index) => ({
        articles_id: { status: { _eq: `s-${index}` } },
      })),
    };
    for (const badFilter of [deepHttpFilter, wideHttpFilter, { title: { _eq: deepScalarHttp } }]) {
      const badRes = await fetch(
        `${origin}/items/${names.translations}?filter=${encodeURIComponent(JSON.stringify(badFilter))}`,
      );
      assert.equal(badRes.status, 400);
      assert.equal((await badRes.json()).errors?.[0]?.code, 'INVALID_QUERY');
    }

    // Even when child collection has filter: null, caller relational filter cannot infer draft parent rows!
    const draftParentProbeFilter = encodeURIComponent(
      JSON.stringify({ articles_id: { id: { _eq: draftArticle.id } } }),
    );
    const draftProbeRes = await fetch(`${origin}/items/${names.notes}?filter=${draftParentProbeFilter}`);
    assert.equal(draftProbeRes.status, 200);
    assert.deepEqual((await draftProbeRes.json()).data, []);

    // Role with child read ONLY (no read permission on parent collection):
    // admin-authored permission.filter still works, but caller-supplied relational userFilter is FORBIDDEN.
    const childOnlyRole = await roles.createOne({ name: `ChildOnly ${token}` });
    createdRoleIds.push(childOnlyRole.id);
    await permissions.createOne({
      role: childOnlyRole.id,
      collection: names.translations,
      action: 'read',
      fields: ['id', 'articles_id', 'slug'],
      filter: { articles_id: { status: { _eq: 'published' } } },
    });
    const childOnlyService = new ItemsService(names.translations, {
      database: pool,
      schemaCache: sharedSchemaCache,
      accountability: createAccountability({ user: 'child-only-user', role: childOnlyRole.id }),
    });
    assert.deepEqual(
      (await childOnlyService.readMany({ sort: 'slug' })).map((row) => row.id),
      [pubEn.id, pubTr.id],
    );
    await assert.rejects(
      childOnlyService.readMany({ filter: { articles_id: { status: { _eq: 'published' } } } }),
      (error) => error.code === 'FORBIDDEN',
    );

    // 3. Create / Update / Delete positive & negative boundaries.
    assert.equal(
      (await fetch(`${origin}/items/${names.translations}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ articles_id: publishedArticle.id, languages_code: 'de', slug: 'anon-de', title: 'Anon DE' }),
      })).status,
      403,
    );
    assert.equal(
      (await fetch(`${origin}/items/${names.translations}/${pubTr.id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ title: 'Anon edit' }),
      })).status,
      403,
    );
    assert.equal(
      (await fetch(`${origin}/items/${names.translations}/${pubTr.id}`, { method: 'DELETE' })).status,
      403,
    );

    const editorRole = await roles.createOne({ name: `ScopedEditor ${token}` });
    createdRoleIds.push(editorRole.id);

    await assert.rejects(
      permissions.createOne({
        role: editorRole.id,
        collection: names.translations,
        action: 'create',
        validation: { articles_id: { status: { _eq: 'published' } } },
      }),
      (error) => error.code === 'INVALID_QUERY',
    );

    await permissions.createOne({
      role: editorRole.id,
      collection: names.articles,
      action: 'read',
      fields: ['id', 'status'],
      filter: { status: { _eq: 'published' } },
    });
    await permissions.createOne({
      role: editorRole.id,
      collection: names.translations,
      action: 'read',
      fields: ['id', 'articles_id', 'languages_code', 'slug', 'title'],
      filter: { articles_id: { status: { _eq: 'published' } } },
    });
    await permissions.createOne({
      role: editorRole.id,
      collection: names.translations,
      action: 'create',
      fields: ['articles_id', 'languages_code', 'slug', 'title'],
    });
    await permissions.createOne({
      role: editorRole.id,
      collection: names.translations,
      action: 'update',
      fields: ['title'],
      filter: { articles_id: { status: { _eq: 'published' } } },
    });
    await permissions.createOne({
      role: editorRole.id,
      collection: names.translations,
      action: 'delete',
      filter: { articles_id: { status: { _eq: 'published' } } },
    });

    const editorPassword = `Editor-m2o-${token}!`;
    const editorUser = await users.createOne({
      email: `editor-m2o-${token}@example.test`,
      password: editorPassword,
      role: editorRole.id,
    });
    createdUserIds.push(editorUser.id);
    const loginRes = await fetch(`${origin}/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: editorUser.email, password: editorPassword }),
    });
    assert.equal(loginRes.status, 200);
    const editorHeaders = {
      'content-type': 'application/json',
      authorization: `Bearer ${(await loginRes.json()).data.access_token}`,
    };

    const createdPubRes = await fetch(`${origin}/items/${names.translations}`, {
      method: 'POST',
      headers: editorHeaders,
      body: JSON.stringify({ articles_id: publishedArticle.id, languages_code: 'de', slug: 'pub-de', title: 'Published DE' }),
    });
    assert.equal(createdPubRes.status, 201);
    const createdPub = (await createdPubRes.json()).data;
    assert.equal(createdPub.title, 'Published DE');

    // Creating a child linked to a draft parent succeeds under create fields, but returns ONLY { id } because read filter excludes draft parents.
    const createdDraftRes = await fetch(`${origin}/items/${names.translations}`, {
      method: 'POST',
      headers: editorHeaders,
      body: JSON.stringify({ articles_id: draftArticle.id, languages_code: 'de', slug: 'draft-de', title: 'Secret Draft DE' }),
    });
    assert.equal(createdDraftRes.status, 201);
    const createdDraft = (await createdDraftRes.json()).data;
    assert.deepEqual(Object.keys(createdDraft), ['id']);

    // Update positive (published parent) + negative (draft parent -> 404, forbidden field -> 403).
    const patchPubRes = await fetch(`${origin}/items/${names.translations}/${pubTr.id}`, {
      method: 'PATCH',
      headers: editorHeaders,
      body: JSON.stringify({ title: 'Yayinda TR Guncel' }),
    });
    assert.equal(patchPubRes.status, 200);
    assert.equal((await patchPubRes.json()).data.title, 'Yayinda TR Guncel');

    const patchDraftRes = await fetch(`${origin}/items/${names.translations}/${draftTr.id}`, {
      method: 'PATCH',
      headers: editorHeaders,
      body: JSON.stringify({ title: 'Must Not Update' }),
    });
    assert.equal(patchDraftRes.status, 404);
    assert.equal((await sysTranslations.readOne(draftTr.id)).title, 'Taslak TR');

    const patchForbiddenFieldRes = await fetch(`${origin}/items/${names.translations}/${pubTr.id}`, {
      method: 'PATCH',
      headers: editorHeaders,
      body: JSON.stringify({ articles_id: draftArticle.id }),
    });
    assert.equal(patchForbiddenFieldRes.status, 403);

    // Bulk updateMany & deleteMany respect relational permission filters and block unreadable relational caller filters.
    const editorItems = new ItemsService(names.translations, {
      database: pool,
      schemaCache: sharedSchemaCache,
      accountability: createAccountability({ user: editorUser.id, role: editorRole.id }),
    });
    await assert.rejects(
      editorItems.updateMany({ articles_id: { secret_notes: { _eq: 'top-secret-published' } } }, { title: 'Blocked' }),
      (error) => error.code === 'INVALID_QUERY',
    );
    await assert.rejects(
      editorItems.updateMany({ languages_code: { _eq: 'tr' } }, { title: 'Blocked unpermitted filter field' }),
      (error) => error.code === 'INVALID_QUERY' && error.path === 'filter.languages_code',
    );
    const bulkUpdated = await editorItems.updateMany({ title: { _contains: 'TR' } }, { title: 'Bulk Published TR' });
    assert.equal(bulkUpdated, 1);
    assert.equal((await sysTranslations.readOne(pubTr.id)).title, 'Bulk Published TR');
    assert.equal((await sysTranslations.readOne(draftTr.id)).title, 'Taslak TR');

    assert.equal(
      (await fetch(`${origin}/items/${names.translations}/${draftTr.id}`, { method: 'DELETE', headers: editorHeaders })).status,
      404,
    );
    assert.equal(
      (await fetch(`${origin}/items/${names.translations}/${createdPub.id}`, { method: 'DELETE', headers: editorHeaders })).status,
      204,
    );

    await assert.rejects(
      editorItems.deleteMany({ articles_id: { secret_notes: { _eq: 'top-secret-published' } } }),
      (error) => error.code === 'INVALID_QUERY' && error.path === 'filter.articles_id.secret_notes',
    );
    const bulkDeleted = await editorItems.deleteMany({ languages_code: { _eq: 'en' } });
    assert.equal(bulkDeleted, 1);
    assert.equal(await sysTranslations.readOne(pubEn.id), null);
    assert.equal((await sysTranslations.readOne(draftEn.id))?.id, draftEn.id);

    // Self-referential M2O UPDATE and DELETE on real MySQL (no errno 1093).
    const pubCat = await sysCategories.createOne({ status: 'published', label: 'Root Published' });
    const draftCat = await sysCategories.createOne({ status: 'draft', label: 'Root Draft' });
    const childPubCat = await sysCategories.createOne({ parent_id: pubCat.id, status: 'draft', label: 'Child of Published' });
    const childDraftCat = await sysCategories.createOne({ parent_id: draftCat.id, status: 'draft', label: 'Child of Draft' });

    for (const action of ['read', 'update', 'delete']) {
      await permissions.createOne({
        role: editorRole.id,
        collection: names.categories,
        action,
        ...(action === 'delete' ? {} : { fields: ['id', 'parent_id', 'status', 'label'] }),
        filter: { parent_id: { status: { _eq: 'published' } } },
      });
    }
    const editorCategories = new ItemsService(names.categories, {
      database: pool,
      schemaCache: sharedSchemaCache,
      accountability: createAccountability({ user: editorUser.id, role: editorRole.id }),
    });
    assert.equal(await editorCategories.updateOne(childDraftCat.id, { label: 'Denied' }), null);
    assert.equal((await editorCategories.updateOne(childPubCat.id, { label: 'Allowed Self Update' }))?.label, 'Allowed Self Update');
    assert.equal(await editorCategories.deleteOne(childDraftCat.id), false);
    assert.equal(await editorCategories.deleteMany({ status: { _eq: 'draft' } }), 1);
    assert.equal(await sysCategories.readOne(childPubCat.id), null);
    assert.equal((await sysCategories.readOne(childDraftCat.id))?.id, childDraftCat.id);

    // 4. Schema and relation mutation safety: immediate fail-closed behavior (0ms delay, no stale 250ms cache window).
    await relations.deleteM2O(names.translations, 'articles_id');
    assert.equal((await fetch(`${origin}/items/${names.translations}`)).status, 400);
    assert.equal(
      (await fetch(`${origin}/items/${names.translations}/${pubTr.id}`, {
        method: 'PATCH',
        headers: editorHeaders,
        body: JSON.stringify({ title: 'After relation drop' }),
      })).status,
      400,
    );
    assert.equal(
      (await fetch(`${origin}/items/${names.translations}/${pubTr.id}`, { method: 'DELETE', headers: editorHeaders })).status,
      400,
    );

    // Restore M2O relation -> permission filter immediately works again.
    await relations.createM2O({
      manyCollection: names.translations,
      manyField: 'articles_id',
      oneCollection: names.articles,
      onDelete: 'SET NULL',
    });
    const restoredRes = await fetch(`${origin}/items/${names.translations}`);
    assert.equal(restoredRes.status, 200);
    assert.deepEqual((await restoredRes.json()).data.map((row) => row.id), [pubTr.id]);

    // Point permission filter at parent `badge` column, then drop `badge` -> fails closed immediately.
    await permissions.updateOne(pubTranslationPerm.id, {
      filter: { articles_id: { badge: { _eq: 'featured' } } },
    });
    assert.equal((await fetch(`${origin}/items/${names.translations}`)).status, 200);
    await fields.deleteOne(names.articles, 'badge', { destructive: true });
    const afterFieldDropRes = await fetch(`${origin}/items/${names.translations}`);
    assert.equal(afterFieldDropRes.status, 400);
    assert.equal((await afterFieldDropRes.json()).errors?.[0]?.code, 'INVALID_QUERY');
  } finally {
    if (server) {
      server.closeAllConnections?.();
      await new Promise((resolve) => server.close(resolve));
    }
    for (const permId of createdPermIds) {
      await pool.query('DELETE FROM yuncms_permissions WHERE id = ?', [permId]).catch(() => {});
    }
    for (const userId of createdUserIds) {
      await pool.query('DELETE FROM yuncms_users WHERE id = ?', [userId]).catch(() => {});
    }
    for (const roleId of createdRoleIds) {
      await pool.query('DELETE FROM yuncms_permissions WHERE role = ?', [roleId]).catch(() => {});
      await pool.query('DELETE FROM yuncms_roles WHERE id = ?', [roleId]).catch(() => {});
    }
    const allCollections = [names.translations, names.notes, names.categories, names.articles];
    await pool.query('SET FOREIGN_KEY_CHECKS = 0').catch(() => {});
    for (const collection of allCollections) {
      const table = quoteIdentifier(collection, 'integration cleanup table');
      await pool.query(`DROP TABLE IF EXISTS ${table}`).catch(() => {});
    }
    await pool.query('SET FOREIGN_KEY_CHECKS = 1').catch(() => {});
    await pool.query(
      `DELETE FROM yuncms_relations
       WHERE many_collection IN (?) OR one_collection IN (?)`,
      [allCollections, allCollections],
    ).catch(() => {});
    await pool.query('DELETE FROM yuncms_collections WHERE collection IN (?)', [allCollections]).catch(() => {});
    await closeDatabasePool(pool).catch(() => {});
  }
});
