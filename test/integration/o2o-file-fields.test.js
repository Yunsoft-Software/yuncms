import assert from 'node:assert/strict';
import test from 'node:test';

import {
  bootstrapDatabase,
  closeDatabasePool,
  CollectionsService,
  createDatabasePool,
  createO2ORelation,
  createSystemAccountability,
  deleteO2ORelation,
  FieldsService,
  ItemsService,
  loadConfig,
} from '@yunsoft/yuncms-core';

const ENABLED = process.env.YUNCMS_TEST_MYSQL === '1';
const DESTRUCTIVE = process.env.YUNCMS_TEST_DB_ALLOW_DESTRUCTIVE === '1';

function suffix() {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`.slice(-10);
}

function requireDisposableDatabase(config) {
  if (!DESTRUCTIVE) throw new Error('YUNCMS_TEST_DB_ALLOW_DESTRUCTIVE=1 is required');
  if (!/(test|ci|dev)/i.test(config.database.database)) {
    throw new Error(`Integration DB name must contain test, ci or dev: ${config.database.database}`);
  }
}

function parseMetadata(value) {
  if (!value) return {};
  return typeof value === 'object' ? value : JSON.parse(value);
}

test('real MySQL enforces O2O uniqueness and file/image field metadata', {
  skip: !ENABLED,
  timeout: 60_000,
}, async () => {
  const config = loadConfig(process.env);
  requireDisposableDatabase(config);
  const pool = createDatabasePool(config.database);
  const system = createSystemAccountability();
  const id = suffix();
  const targets = `it_o2o_targets_${id}`;
  const sources = `it_o2o_sources_${id}`;
  const collections = new CollectionsService({ database: pool, accountability: system });
  const fields = new FieldsService({ database: pool, accountability: system });
  let relationCreated = false;

  try {
    await bootstrapDatabase(pool);
    await collections.createOne({ collection: targets });
    await collections.createOne({ collection: sources });

    await fields.createOne(sources, { field: 'target_id', type: 'uuid', required: false });
    await fields.createOne(sources, {
      field: 'attachment',
      type: 'uuid',
      interface: 'file',
      options: { preview: true },
      required: false,
    });
    await fields.createOne(sources, {
      field: 'cover_image',
      type: 'uuid',
      interface: 'image',
      options: { accept: 'image/*', preview: true },
      required: false,
    });

    const attachment = await fields.readOne(sources, 'attachment');
    const cover = await fields.readOne(sources, 'cover_image');
    assert.equal(attachment.type, 'uuid');
    assert.equal(attachment.interface, 'file');
    assert.equal(cover.type, 'uuid');
    assert.equal(cover.interface, 'image');

    const relation = await createO2ORelation({
      database: pool,
      accountability: system,
      input: {
        manyCollection: sources,
        manyField: 'target_id',
        oneCollection: targets,
        onDelete: 'SET NULL',
      },
    });
    relationCreated = true;
    const metadata = parseMetadata(relation.metadata);
    assert.equal(metadata.kind, 'o2o');
    assert.ok(metadata.uniqueIndex);

    const targetItems = new ItemsService(targets, { database: pool, accountability: system });
    const sourceItems = new ItemsService(sources, { database: pool, accountability: system });
    const target = await targetItems.createOne({});
    await sourceItems.createOne({ target_id: target.id });
    await assert.rejects(
      sourceItems.createOne({ target_id: target.id }),
      (error) => error?.code === 'ER_DUP_ENTRY' || error?.code === 'DUPLICATE_KEY' || /duplicate/i.test(error?.message || ''),
    );

    await deleteO2ORelation({
      database: pool,
      accountability: system,
      manyCollection: sources,
      manyField: 'target_id',
    });
    relationCreated = false;

    const [indexes] = await pool.query(
      `SELECT INDEX_NAME
       FROM INFORMATION_SCHEMA.STATISTICS
       WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
      [config.database.database, sources, 'target_id'],
    );
    assert.equal(indexes.some((row) => String(row.INDEX_NAME).startsWith('yuo_')), false);
  } finally {
    if (relationCreated) {
      await deleteO2ORelation({
        database: pool,
        accountability: system,
        manyCollection: sources,
        manyField: 'target_id',
      }).catch(() => {});
    }
    await collections.deleteOne(sources, { destructive: true }).catch(() => {});
    await collections.deleteOne(targets, { destructive: true }).catch(() => {});
    await closeDatabasePool(pool);
  }
});
