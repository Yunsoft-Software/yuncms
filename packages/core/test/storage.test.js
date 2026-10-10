import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { LocalStorageDriver, assertStorageKey, createStorageRegistry } from '../src/index.js';

test('storage keys reject traversal and path separators', () => {
  for (const value of ['../secret', 'a/b', 'a\\b', '..', '/absolute']) {
    assert.throws(
      () => assertStorageKey(value),
      (error) => error.code === 'INVALID_STORAGE_KEY',
    );
  }

  assert.equal(assertStorageKey('550e8400-e29b-41d4-a716-446655440000'), '550e8400-e29b-41d4-a716-446655440000');
});

test('local storage driver put/get/stat/delete stays inside configured root', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'yuncms-storage-'));
  t.after(() => rm(root, { recursive: true, force: true }));

  const driver = new LocalStorageDriver({ root });
  const key = '550e8400-e29b-41d4-a716-446655440000';
  const contents = Buffer.from('hello yuncms');

  const stored = await driver.put(key, contents);
  assert.equal(stored.key, key);
  assert.equal(stored.size, contents.byteLength);

  const loaded = await driver.get(key);
  assert.deepEqual(loaded, contents);

  const info = await driver.stat(key);
  assert.equal(info.key, key);
  assert.equal(info.size, contents.byteLength);

  assert.equal(await driver.delete(key), true);
  assert.equal(await driver.stat(key), null);
  assert.equal(await driver.delete(key), false);
});

test('storage registry rejects incomplete drivers and unknown names', () => {
  assert.throws(
    () => createStorageRegistry({ broken: {} }),
    /must implement put/,
  );

  const noop = {
    async put() {},
    async get() {},
    async delete() {},
    async stat() {},
    async getSignedUrl() {},
  };
  const registry = createStorageRegistry({ local: noop });
  assert.equal(registry.get('local'), noop);
  assert.throws(
    () => registry.get('missing'),
    (error) => error.code === 'STORAGE_NOT_FOUND',
  );

  // Optional getStream must not be required
  assert.equal(typeof registry.get('local').getStream, 'undefined');

  // If getStream is provided, it must be a function
  assert.throws(
    () => createStorageRegistry({
      invalid: {
        ...noop,
        getStream: 'not-a-function',
      },
    }),
    /getStream must be a function/,
  );
});

test('local storage driver getStream streams full bytes and subranges with bounded chunks', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'yuncms-storage-'));
  t.after(() => rm(root, { recursive: true, force: true }));

  const driver = new LocalStorageDriver({ root });
  const key = '550e8400-e29b-41d4-a716-446655440001';
  const contents = Buffer.from('abcdefghijklmnopqrstuvwxyz0123456789');

  await driver.put(key, contents);

  // Full stream
  const fullStream = await driver.getStream(key);
  assert.equal(fullStream.readableHighWaterMark, 64 * 1024);
  const fullChunks = [];
  for await (const chunk of fullStream) fullChunks.push(chunk);
  assert.deepEqual(Buffer.concat(fullChunks), contents);

  // Subrange stream { start: 10, end: 19 }
  const subStream = await driver.getStream(key, { start: 10, end: 19 });
  const subChunks = [];
  for await (const chunk of subStream) subChunks.push(chunk);
  assert.deepEqual(Buffer.concat(subChunks), contents.subarray(10, 20));

  // End-only subrange { end: 3 } returns bytes 0..3
  const endOnlyStream = await driver.getStream(key, { end: 3 });
  const endOnlyChunks = [];
  for await (const chunk of endOnlyStream) endOnlyChunks.push(chunk);
  assert.deepEqual(Buffer.concat(endOnlyChunks), contents.subarray(0, 4));
});
