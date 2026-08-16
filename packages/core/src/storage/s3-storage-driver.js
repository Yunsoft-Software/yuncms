import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';

import { assertStorageKey } from './local-storage-driver.js';

async function bodyToBuffer(body) {
  if (!body) return Buffer.alloc(0);
  if (typeof body.transformToByteArray === 'function') {
    return Buffer.from(await body.transformToByteArray());
  }
  if (Symbol.asyncIterator in Object(body)) {
    const chunks = [];
    for await (const chunk of body) chunks.push(Buffer.from(chunk));
    return Buffer.concat(chunks);
  }
  throw new Error('Unsupported S3 response body type');
}

function credentialsFromConfig({ accessKeyId, secretAccessKey }) {
  if (!accessKeyId && !secretAccessKey) return undefined;
  if (!accessKeyId || !secretAccessKey) {
    throw new Error('S3 access key id and secret access key must be configured together');
  }
  return { accessKeyId, secretAccessKey };
}

export class S3StorageDriver {
  constructor({
    bucket,
    region = 'us-east-1',
    endpoint = undefined,
    accessKeyId = undefined,
    secretAccessKey = undefined,
    forcePathStyle = false,
    client = null,
  } = {}) {
    if (!bucket || typeof bucket !== 'string') throw new Error('S3 bucket is required');
    this.bucket = bucket;
    this.client = client ?? new S3Client({
      region,
      ...(endpoint ? { endpoint } : {}),
      ...(credentialsFromConfig({ accessKeyId, secretAccessKey })
        ? { credentials: credentialsFromConfig({ accessKeyId, secretAccessKey }) }
        : {}),
      forcePathStyle: forcePathStyle === true,
    });
  }

  async put(key, contents) {
    const safeKey = assertStorageKey(key);
    if (!Buffer.isBuffer(contents) && !(contents instanceof Uint8Array)) {
      const error = new Error('S3 storage put requires Buffer or Uint8Array content');
      error.code = 'INVALID_FILE_CONTENT';
      throw error;
    }
    await this.client.send(new PutObjectCommand({
      Bucket: this.bucket,
      Key: safeKey,
      Body: contents,
    }));
    return { key: safeKey, size: contents.byteLength };
  }

  async get(key) {
    const safeKey = assertStorageKey(key);
    const response = await this.client.send(new GetObjectCommand({
      Bucket: this.bucket,
      Key: safeKey,
    }));
    return bodyToBuffer(response.Body);
  }

  async stat(key) {
    const safeKey = assertStorageKey(key);
    try {
      const response = await this.client.send(new HeadObjectCommand({
        Bucket: this.bucket,
        Key: safeKey,
      }));
      return {
        key: safeKey,
        size: Number(response.ContentLength ?? 0),
        modifiedAt: response.LastModified ?? null,
        etag: response.ETag ?? null,
      };
    } catch (error) {
      if (error?.$metadata?.httpStatusCode === 404 || error?.name === 'NotFound' || error?.name === 'NoSuchKey') {
        return null;
      }
      throw error;
    }
  }

  async list() {
    const objects = [];
    let continuationToken;

    do {
      const response = await this.client.send(new ListObjectsV2Command({
        Bucket: this.bucket,
        ...(continuationToken ? { ContinuationToken: continuationToken } : {}),
      }));

      for (const object of response.Contents ?? []) {
        if (!object.Key) continue;
        try {
          const key = assertStorageKey(object.Key);
          objects.push({
            key,
            size: Number(object.Size ?? 0),
            modifiedAt: object.LastModified ?? null,
            etag: object.ETag ?? null,
          });
        } catch (error) {
          if (error?.code !== 'INVALID_STORAGE_KEY') throw error;
        }
      }

      continuationToken = response.IsTruncated ? response.NextContinuationToken : undefined;
      if (response.IsTruncated && !continuationToken) {
        const error = new Error('S3 inventory response was truncated without a continuation token');
        error.code = 'STORAGE_INVENTORY_FAILED';
        throw error;
      }
    } while (continuationToken);

    return objects;
  }

  async delete(key) {
    const safeKey = assertStorageKey(key);
    await this.client.send(new DeleteObjectCommand({
      Bucket: this.bucket,
      Key: safeKey,
    }));
    return true;
  }

  async getSignedUrl() {
    return null;
  }
}

export { bodyToBuffer, credentialsFromConfig };
