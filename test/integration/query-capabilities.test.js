import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';

import {
  bootstrapDatabase,
  closeDatabasePool,
  CollectionsService,
  createAccountability,
  createDatabasePool,
  createSystemAccountability,
  FieldsService,
  ItemsService,
  loadConfig,
  PermissionsService,
  quoteIdentifier,
  readManyWithRelations,
  RelationsService,
  RolesService,
  SchemaCache,
} from '@yunsoft/yuncms-core';

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
