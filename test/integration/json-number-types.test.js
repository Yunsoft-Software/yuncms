import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import {
  bootstrapDatabase,
  CollectionsService,
  createDatabasePool,
  createSystemAccountability,
  FieldsService,
  ItemsService,
  loadConfig,
  quoteIdentifier,
  SchemaCache,
} from '@yunsoft/yuncms-core';

test('native JSON round trips preserve nested number types and SQL BIGINT precision', {
  skip: process.env.YUNCMS_TEST_MYSQL !== '1',
  timeout: 30_000,
}, async () => {
  const config = loadConfig(process.env);
  assert.equal(process.env.YUNCMS_TEST_DB_ALLOW_DESTRUCTIVE, '1');
  assert.match(config.database.database, /test|ci|dev/i);
  const database = createDatabasePool(config.database);
  const options = { database, accountability: createSystemAccountability(), schemaCache: new SchemaCache() };
  const collection = `json_numbers_${randomUUID().replaceAll('-', '')}`;
  const collections = new CollectionsService(options);
  const fields = new FieldsService(options);
  const items = new ItemsService(collection, options);
  const id = randomUUID();
  const document = '{"properties":{"seed":{"type":"integer","maximum":9223372036854776000}},"values":[9007199254740993,"9007199254740993",1.25,null,"Türkçe 🙂"]}';
  const bigint = '9223372036854775807';
  const table = quoteIdentifier(collection);
  const select = `SELECT config, counter, optional FROM ${table} WHERE id = ?`;
  const inspect = `SELECT JSON_TYPE(JSON_EXTRACT(config, '$.properties.seed.maximum')) AS maximum_type,
    JSON_TYPE(JSON_EXTRACT(config, '$.values[0]')) AS number_type,
    JSON_TYPE(JSON_EXTRACT(config, '$.values[1]')) AS string_type FROM ${table} WHERE id = ?`;
  let created = false;

  try {
    await bootstrapDatabase(database);
    await collections.createOne({ collection });
    created = true;
    await fields.createOne(collection, { field: 'config', type: 'json' });
    await fields.createOne(collection, { field: 'counter', type: 'bigint' });
    await fields.createOne(collection, { field: 'optional', type: 'json' });
    await database.execute(`INSERT INTO ${table} (id, config, counter) VALUES (?, ?, ?)`, [id, document, bigint]);
    const [[before]] = await database.query(inspect, [id]);
    assert.match(before.maximum_type, /^(?:UNSIGNED )?INTEGER$/);
    assert.match(before.number_type, /^(?:UNSIGNED )?INTEGER$/);
    assert.equal(before.string_type, 'STRING');

    const expected = JSON.parse(document);
    for (const method of ['query', 'execute']) {
      const [[row]] = await database[method](select, [id]);
      assert.deepEqual(row, { config: expected, counter: bigint, optional: null }, method);
    }
    const item = await items.readOne(id);
    assert.deepEqual(item.config, expected);
    assert.equal(item.counter, bigint);
    await items.updateOne(id, { config: { ...item.config, title: 'Updated' } });
    assert.deepEqual((await items.readOne(id)).config, { ...expected, title: 'Updated' });
    const [[after]] = await database.query(inspect, [id]);
    assert.deepEqual(after, before);
  } finally {
    try {
      if (created) await collections.deleteOne(collection, { destructive: true });
    } finally {
      await database.end();
    }
  }
});
