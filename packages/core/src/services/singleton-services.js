import { withAdvisoryLock } from '../advisory-lock.js';
import { quoteIdentifier } from '../identifier.js';
import { CollectionsService } from './collections-service.js';
import { ItemsService } from './items-service.js';

function singletonError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

async function assertSingletonVacant(database, collection, schema) {
  if (!schema?.singleton) return;
  const table = quoteIdentifier(collection, 'collection name');
  const [rows] = await database.query(`SELECT 1 AS present FROM ${table} LIMIT 1`);
  if (rows[0]) {
    throw singletonError('SINGLETON_ITEM_EXISTS', `Singleton collection already contains an item: ${collection}`);
  }
}

export class SingletonItemsService extends ItemsService {
  async createOne(payload = {}) {
    const schema = await this.getCollectionSchema();
    if (!schema.singleton) return super.createOne(payload);
    return withAdvisoryLock(
      this.database,
      `yuncms:singleton:${this.collection}`,
      async (connection) => {
        await assertSingletonVacant(connection, this.collection, schema);
        return super.createOne(payload);
      },
      { timeoutSeconds: 10 },
    );
  }

  async createMany(payloads = []) {
    const schema = await this.getCollectionSchema();
    if (!schema.singleton) return super.createMany(payloads);
    if (!Array.isArray(payloads) || payloads.length !== 1) {
      throw singletonError('SINGLETON_BULK_CREATE_FORBIDDEN', 'Singleton collections accept exactly one create payload');
    }
    return withAdvisoryLock(
      this.database,
      `yuncms:singleton:${this.collection}`,
      async (connection) => {
        await assertSingletonVacant(connection, this.collection, schema);
        return super.createMany(payloads);
      },
      { timeoutSeconds: 10 },
    );
  }
}

export class SingletonCollectionsService extends CollectionsService {
  async updateOne(collection, patch) {
    if (patch?.singleton === true) {
      const existing = await this.readOne(collection);
      if (existing && !existing.singleton && !existing.system) {
        const table = quoteIdentifier(collection, 'collection name');
        const [rows] = await this.database.query(`SELECT COUNT(*) AS count FROM ${table}`);
        if (Number(rows?.[0]?.count ?? 0) > 1) {
          throw singletonError(
            'SINGLETON_MULTIPLE_ITEMS',
            'A collection with more than one item cannot be converted to singleton',
          );
        }
      }
    }
    return super.updateOne(collection, patch);
  }
}

export { assertSingletonVacant };
