import { randomUUID } from 'node:crypto';

import { assertIdentifier, quoteIdentifier } from '../identifier.js';
import {
  compileFilter,
  compileSelectFields,
  compileSort,
  parseItemsQuery,
} from '../query.js';
import { SchemaCache } from '../schema.js';
import { withTransaction } from '../transaction.js';
import { BaseService } from './base-service.js';

const defaultSchemaCache = new SchemaCache();

function serviceError(code, message, path = null) {
  const error = new Error(message);
  error.code = code;
  if (path) error.path = path;
  return error;
}

function parseMetadata(value) {
  if (value == null || typeof value === 'object') return value ?? {};
  try {
    return JSON.parse(value);
  } catch {
    return {};
  }
}

export class ItemsService extends BaseService {
  constructor(collection, options = {}) {
    super(options);
    this.collection = assertIdentifier(collection, 'collection name');
    this.schemaCache = options.schemaCache ?? defaultSchemaCache;
  }

  assertAuthorized() {
    if (this.accountability.admin === true || this.accountability.system === true) return;
    throw serviceError(
      'PERMISSIONS_NOT_READY',
      'ItemsService is restricted to explicit admin/system accountability until RBAC enforcement is implemented',
    );
  }

  async getCollectionSchema(database = this.database) {
    const snapshot = this.schema ?? await this.schemaCache.get(database);
    const collectionSchema = snapshot?.collections?.[this.collection];
    if (!collectionSchema) {
      throw serviceError('COLLECTION_NOT_FOUND', `Unknown collection: ${this.collection}`);
    }
    return collectionSchema;
  }

  async readMany(rawQuery = {}) {
    return (await this.readManyWithMeta(rawQuery)).data;
  }

  async readManyWithMeta(rawQuery = {}) {
    this.assertAuthorized();
    const schema = await this.getCollectionSchema();
    const query = parseItemsQuery(rawQuery);
    const selected = compileSelectFields(query.fields, schema);
    const filter = compileFilter(query.filter, schema);
    const sortSql = compileSort(query.sort, schema);
    const table = quoteIdentifier(this.collection, 'collection name');

    const [rows] = await this.database.query(
      `SELECT ${selected.sql} FROM ${table}${filter.sql}${sortSql} LIMIT ? OFFSET ?`,
      [...filter.params, query.limit, query.offset],
    );
    const [countRows] = await this.database.query(
      `SELECT COUNT(*) AS total_count FROM ${table}${filter.sql}`,
      filter.params,
    );

    return {
      data: rows,
      meta: {
        total_count: Number(countRows?.[0]?.total_count ?? 0),
        limit: query.limit,
        offset: query.offset,
      },
    };
  }

  async readOne(id, { fields = null } = {}) {
    this.assertAuthorized();
    const schema = await this.getCollectionSchema();
    const selected = compileSelectFields(fields, schema);
    const table = quoteIdentifier(this.collection, 'collection name');
    const primaryKey = quoteIdentifier(schema.primary_key, 'primary key');
    const [rows] = await this.database.query(
      `SELECT ${selected.sql} FROM ${table} WHERE ${primaryKey} = ? LIMIT 1`,
      [id],
    );
    return rows[0] ?? null;
  }

  validatePayload(payload, schema, { creating = false } = {}) {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      throw serviceError('INVALID_PAYLOAD', 'Payload must be an object');
    }

    const entries = Object.entries(payload);
    for (const [field] of entries) {
      const fieldSchema = schema.fields[field];
      if (!fieldSchema) throw serviceError('INVALID_PAYLOAD', `Unknown field: ${field}`, field);
      if (fieldSchema.readonly) throw serviceError('FIELD_READ_ONLY', `Field is read-only: ${field}`, field);
    }

    if (creating) {
      for (const fieldSchema of Object.values(schema.fields)) {
        if (!fieldSchema.required || fieldSchema.field === schema.primary_key) continue;
        if (Object.hasOwn(payload, fieldSchema.field)) continue;
        const metadata = parseMetadata(fieldSchema.schema_metadata);
        if (Object.hasOwn(metadata, 'defaultValue')) continue;
        throw serviceError('REQUIRED_FIELD_MISSING', `Required field is missing: ${fieldSchema.field}`, fieldSchema.field);
      }
    }

    return entries;
  }

  async createOne(payload = {}) {
    this.assertAuthorized();
    const schema = await this.getCollectionSchema();
    const entries = this.validatePayload(payload, schema, { creating: true });
    const id = randomUUID();
    const values = { [schema.primary_key]: id, ...Object.fromEntries(entries) };
    const fields = Object.keys(values);
    const table = quoteIdentifier(this.collection, 'collection name');

    await this.database.query(
      `INSERT INTO ${table} (${fields.map((field) => quoteIdentifier(field, 'field name')).join(', ')})
       VALUES (${fields.map(() => '?').join(', ')})`,
      fields.map((field) => values[field]),
    );

    return this.readOne(id);
  }

  async createMany(payloads = []) {
    this.assertAuthorized();
    if (!Array.isArray(payloads) || payloads.length === 0) {
      throw serviceError('INVALID_PAYLOAD', 'createMany requires a non-empty array');
    }

    const schema = await this.getCollectionSchema();
    const createdIds = [];

    await withTransaction(this.database, async (connection) => {
      const table = quoteIdentifier(this.collection, 'collection name');

      for (const payload of payloads) {
        const entries = this.validatePayload(payload, schema, { creating: true });
        const id = randomUUID();
        const values = { [schema.primary_key]: id, ...Object.fromEntries(entries) };
        const fields = Object.keys(values);

        await connection.query(
          `INSERT INTO ${table} (${fields.map((field) => quoteIdentifier(field, 'field name')).join(', ')})
           VALUES (${fields.map(() => '?').join(', ')})`,
          fields.map((field) => values[field]),
        );
        createdIds.push(id);
      }
    });

    const records = [];
    for (const id of createdIds) records.push(await this.readOne(id));
    return records;
  }

  async updateOne(id, payload = {}) {
    this.assertAuthorized();
    const schema = await this.getCollectionSchema();
    const entries = this.validatePayload(payload, schema);
    if (entries.length === 0) throw serviceError('INVALID_PAYLOAD', 'Update payload cannot be empty');

    const table = quoteIdentifier(this.collection, 'collection name');
    const primaryKey = quoteIdentifier(schema.primary_key, 'primary key');
    const setSql = entries.map(([field]) => `${quoteIdentifier(field, 'field name')} = ?`).join(', ');
    const [result] = await this.database.query(
      `UPDATE ${table} SET ${setSql} WHERE ${primaryKey} = ?`,
      [...entries.map(([, value]) => value), id],
    );

    if (result.affectedRows === 0) return null;
    return this.readOne(id);
  }

  async updateMany(filterInput, payload = {}) {
    this.assertAuthorized();
    if (!filterInput || typeof filterInput !== 'object' || Array.isArray(filterInput) || Object.keys(filterInput).length === 0) {
      throw serviceError('FILTER_REQUIRED', 'updateMany requires an explicit non-empty filter');
    }

    const schema = await this.getCollectionSchema();
    const entries = this.validatePayload(payload, schema);
    if (entries.length === 0) throw serviceError('INVALID_PAYLOAD', 'Update payload cannot be empty');
    const filter = compileFilter(filterInput, schema);
    const table = quoteIdentifier(this.collection, 'collection name');
    const setSql = entries.map(([field]) => `${quoteIdentifier(field, 'field name')} = ?`).join(', ');
    const [result] = await this.database.query(
      `UPDATE ${table} SET ${setSql}${filter.sql}`,
      [...entries.map(([, value]) => value), ...filter.params],
    );
    return result.affectedRows;
  }

  async deleteOne(id) {
    this.assertAuthorized();
    const schema = await this.getCollectionSchema();
    const table = quoteIdentifier(this.collection, 'collection name');
    const primaryKey = quoteIdentifier(schema.primary_key, 'primary key');
    const [result] = await this.database.query(
      `DELETE FROM ${table} WHERE ${primaryKey} = ?`,
      [id],
    );
    return result.affectedRows > 0;
  }

  async deleteMany(filterInput) {
    this.assertAuthorized();
    if (!filterInput || typeof filterInput !== 'object' || Array.isArray(filterInput) || Object.keys(filterInput).length === 0) {
      throw serviceError('FILTER_REQUIRED', 'deleteMany requires an explicit non-empty filter');
    }

    const schema = await this.getCollectionSchema();
    const filter = compileFilter(filterInput, schema);
    const table = quoteIdentifier(this.collection, 'collection name');
    const [result] = await this.database.query(
      `DELETE FROM ${table}${filter.sql}`,
      filter.params,
    );
    return result.affectedRows;
  }
}
