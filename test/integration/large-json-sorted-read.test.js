import assert from 'node:assert/strict';
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
  RolesService,
  SchemaCache,
} from '@yunsoft/yuncms-core';

const ENABLED = process.env.YUNCMS_TEST_MYSQL === '1';
const DESTRUCTIVE = process.env.YUNCMS_TEST_DB_ALLOW_DESTRUCTIVE === '1';

function requireDisposableDatabase(config) {
  if (!DESTRUCTIVE) {
    throw new Error('YUNCMS_TEST_DB_ALLOW_DESTRUCTIVE=1 is required for integration suite');
  }
  const dbName = config.database?.database ?? '';
  if (!/(test|ci|dev)/i.test(dbName)) {
    throw new Error(`Integration DB name must contain test, ci or dev: ${dbName}`);
  }
}

function suffix() {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`.slice(-9);
}

test('sorted collection reads selecting large JSON/TEXT succeed with two-phase materialization under constrained sort_buffer_size', {
  skip: !ENABLED,
  timeout: 60_000,
}, async () => {
  const config = loadConfig(process.env);
  requireDisposableDatabase(config);
  const pool = createDatabasePool(config.database);

  const collection = `it_large_json_${suffix()}`;
  const schemaCache = new SchemaCache({ versionCheckTtlMs: 0 });
  const options = {
    database: pool,
    accountability: createSystemAccountability(),
    schemaCache,
  };

  const collections = new CollectionsService(options);
  const fields = new FieldsService(options);
  const roles = new RolesService(options);
  const permissions = new PermissionsService(options);

  let collectionCreated = false;
  let createdRole = null;

  try {
    await bootstrapDatabase(pool);
    await collections.createOne({ collection, systemFields: ['created_at'] });
    collectionCreated = true;
    await fields.createOne(collection, { field: 'title', type: 'string' });
    // sort_key is intentionally unindexed to force MySQL filesort
    await fields.createOne(collection, { field: 'sort_key', type: 'integer' });
    await fields.createOne(collection, { field: 'status', type: 'string' });
    await fields.createOne(collection, { field: 'payload', type: 'json' });

    // Seed 8 rows with synthetic large JSON payloads (48KB each = ~384KB total)
    const items = new ItemsService(collection, options);
    const rawItems = [
      { sort_key: 80, title: 'Item 80', status: 'active', payload: { data: 'a'.repeat(49_152) } },
      { sort_key: 20, title: 'Item 20', status: 'active', payload: { data: 'b'.repeat(49_152) } },
      { sort_key: 50, title: 'Item 50', status: 'inactive', payload: { data: 'c'.repeat(49_152) } },
      { sort_key: 10, title: 'Item 10', status: 'active', payload: { data: 'd'.repeat(49_152) } },
      { sort_key: 70, title: 'Item 70', status: 'active', payload: { data: 'e'.repeat(49_152) } },
      { sort_key: 40, title: 'Item 40', status: 'inactive', payload: { data: 'f'.repeat(49_152) } },
      { sort_key: 60, title: 'Item 60', status: 'active', payload: { data: 'g'.repeat(49_152) } },
      { sort_key: 30, title: 'Item 30', status: 'active', payload: { data: 'h'.repeat(49_152) } },
    ];
    for (const raw of rawItems) {
      await items.createOne(raw);
    }

    // Pin one connection so session sort_buffer_size stays isolated to this test
    const connection = await pool.getConnection();
    let originalSortBufferSize = null;

    try {
      const [[{ original }]] = await connection.query('SELECT @@SESSION.sort_buffer_size AS original');
      const rawSize = Number(original);
      if (!Number.isSafeInteger(rawSize) || rawSize <= 0) {
        throw new Error(`Invalid @@SESSION.sort_buffer_size returned: ${original}`);
      }
      originalSortBufferSize = rawSize;

      // 32768 is the minimum valid sort_buffer_size in MySQL
      await connection.query('SET SESSION sort_buffer_size = 32768');

      const table = quoteIdentifier(collection, 'collection name');

      // Control assertion: direct unindexed wide query fails with ER_OUT_OF_SORTMEMORY
      let controlError = null;
      try {
        await connection.query(`SELECT \`id\`, \`sort_key\`, \`payload\` FROM ${table} ORDER BY \`sort_key\` ASC`);
      } catch (err) {
        controlError = err;
      }
      assert.ok(controlError, 'Direct wide filesort query should fail under constrained sort_buffer_size');
      assert.ok(
        controlError.code === 'ER_OUT_OF_SORTMEMORY' ||
        controlError.errno === 1038 ||
        /sort memory/i.test(controlError.message),
        `Expected ER_OUT_OF_SORTMEMORY, got: ${controlError.code} (${controlError.message})`,
      );

      // Pinned items service using the connection with sort_buffer_size = 32KB
      const pinnedService = new ItemsService(collection, {
        ...options,
        database: connection,
      });

      // 1. Full/default field read with explicit sort succeeds via two-phase materialization
      const fullRead = await pinnedService.readManyWithMeta({
        sort: ['sort_key'],
      });
      assert.equal(fullRead.data.length, 8);
      assert.equal(fullRead.meta.total_count, 8);
      // Assert ascending order
      for (let i = 1; i < fullRead.data.length; i++) {
        assert.ok(
          fullRead.data[i - 1].sort_key < fullRead.data[i].sort_key,
          `Expected ascending order, but row ${i - 1} (${fullRead.data[i - 1].sort_key}) >= row ${i} (${fullRead.data[i].sort_key})`,
        );
      }
      assert.equal(fullRead.data[0].sort_key, 10);
      assert.ok(fullRead.data[0].payload?.data?.length > 40_000);

      // 2. Narrowed projection (small fields only) succeeds
      const narrowedRead = await pinnedService.readManyWithMeta({
        fields: ['id', 'sort_key', 'title'],
        sort: ['sort_key'],
      });
      assert.equal(narrowedRead.data.length, 8);
      assert.equal(narrowedRead.data[0].sort_key, 10);
      for (const row of narrowedRead.data) {
        assert.equal(Object.hasOwn(row, 'payload'), false);
      }

      // 3. Offset, limit, and count metadata
      const pagedRead = await pinnedService.readManyWithMeta({
        fields: ['id', 'sort_key', 'payload'],
        sort: ['sort_key'],
        limit: 3,
        offset: 2,
      });
      assert.equal(pagedRead.meta.total_count, 8);
      assert.equal(pagedRead.meta.limit, 3);
      assert.equal(pagedRead.meta.offset, 2);
      assert.equal(pagedRead.data.length, 3);
      // Slice [2..5] of sorted items [10, 20, 30, 40, 50, 60, 70, 80] is [30, 40, 50]
      assert.deepEqual(pagedRead.data.map((r) => r.sort_key), [30, 40, 50]);

      // 4. Restricted role read with row-level filter and sort
      createdRole = await roles.createOne({ name: `large-role-${suffix()}` });
      await permissions.createOne({
        role: createdRole.id,
        collection,
        action: 'read',
        fields: ['id', 'sort_key', 'payload', 'status'],
        filter: { status: { _eq: 'active' } },
      });

      const restrictedService = new ItemsService(collection, {
        ...options,
        database: connection,
        accountability: createAccountability({ user: 'restricted-user', role: createdRole.id }),
      });

      const restrictedRead = await restrictedService.readManyWithMeta({
        sort: ['sort_key'],
      });
      assert.equal(restrictedRead.data.length, 6); // 6 active rows
      assert.equal(restrictedRead.meta.total_count, 6);
      for (const row of restrictedRead.data) {
        assert.equal(row.status, 'active');
      }
      assert.deepEqual(restrictedRead.data.map((r) => r.sort_key), [10, 20, 30, 60, 70, 80]);
    } finally {
      try {
        if (originalSortBufferSize != null) {
          await connection.query('SET SESSION sort_buffer_size = ?', [originalSortBufferSize]);
        }
      } finally {
        connection.release();
      }
    }
  } finally {
    const cleanupErrors = [];
    if (collectionCreated) {
      try {
        await collections.deleteOne(collection, { destructive: true });
      } catch (err) {
        cleanupErrors.push(err);
      }
    }
    if (createdRole?.id) {
      try {
        await roles.deleteOne(createdRole.id);
      } catch (err) {
        cleanupErrors.push(err);
      }
    }
    try {
      await closeDatabasePool(pool);
    } catch (err) {
      cleanupErrors.push(err);
    }
    if (cleanupErrors.length > 0) {
      throw new Error(`Integration cleanup failed with ${cleanupErrors.length} error(s): ${cleanupErrors.map((e) => e.message).join('; ')}`);
    }
  }
});
