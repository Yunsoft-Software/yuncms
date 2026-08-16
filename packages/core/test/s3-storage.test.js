import assert from 'node:assert/strict';
import test from 'node:test';

import { S3StorageDriver } from '../src/storage/s3-storage-driver.js';

class FakeS3Client {
  constructor(responses = []) {
    this.responses = [...responses];
    this.commands = [];
  }

  async send(command) {
    this.commands.push(command);
    return this.responses.shift() ?? {};
  }
}

test('S3 storage driver binds bucket/key/content through SDK commands', async () => {
  const client = new FakeS3Client([
    {},
    { Body: { transformToByteArray: async () => Uint8Array.from([1, 2, 3]) } },
    { ContentLength: 3, LastModified: new Date('2026-08-17T00:00:00Z'), ETag: 'etag' },
    {},
  ]);
  const driver = new S3StorageDriver({ bucket: 'bucket', client });
  const key = '550e8400-e29b-41d4-a716-446655440000';

  await driver.put(key, Buffer.from([1, 2, 3]));
  assert.equal(client.commands[0].input.Bucket, 'bucket');
  assert.equal(client.commands[0].input.Key, key);

  assert.deepEqual(await driver.get(key), Buffer.from([1, 2, 3]));
  const info = await driver.stat(key);
  assert.equal(info.size, 3);
  assert.equal(info.etag, 'etag');

  assert.equal(await driver.delete(key), true);
  assert.equal(client.commands[3].input.Key, key);
});

test('S3 storage inventory follows continuation tokens and skips unsafe foreign keys', async () => {
  const firstModified = new Date('2026-08-16T20:00:00Z');
  const secondModified = new Date('2026-08-16T21:00:00Z');
  const client = new FakeS3Client([
    {
      Contents: [
        { Key: '550e8400-e29b-41d4-a716-446655440000', Size: 3, LastModified: firstModified },
        { Key: 'foreign/folder/object', Size: 10, LastModified: firstModified },
      ],
      IsTruncated: true,
      NextContinuationToken: 'next-page',
    },
    {
      Contents: [
        { Key: '550e8400-e29b-41d4-a716-446655440001', Size: 4, LastModified: secondModified },
      ],
      IsTruncated: false,
    },
  ]);
  const driver = new S3StorageDriver({ bucket: 'bucket', client });

  const objects = await driver.list();
  assert.deepEqual(objects.map((entry) => entry.key), [
    '550e8400-e29b-41d4-a716-446655440000',
    '550e8400-e29b-41d4-a716-446655440001',
  ]);
  assert.equal(client.commands.length, 2);
  assert.equal(client.commands[0].input.ContinuationToken, undefined);
  assert.equal(client.commands[1].input.ContinuationToken, 'next-page');
});

test('S3 storage inventory fails when a truncated page has no continuation token', async () => {
  const client = new FakeS3Client([{ Contents: [], IsTruncated: true }]);
  const driver = new S3StorageDriver({ bucket: 'bucket', client });

  await assert.rejects(
    driver.list(),
    (error) => error.code === 'STORAGE_INVENTORY_FAILED',
  );
});

test('S3 storage driver rejects unsafe object keys before SDK call', async () => {
  const client = new FakeS3Client();
  const driver = new S3StorageDriver({ bucket: 'bucket', client });

  await assert.rejects(
    driver.get('../secret'),
    (error) => error.code === 'INVALID_STORAGE_KEY',
  );
  assert.equal(client.commands.length, 0);
});
