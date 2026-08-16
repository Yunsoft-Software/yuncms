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
import { PermissionsService } from './permissions-service.js';

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

function schemaForFields(schema, allowedFields) {
  if (allowedFields == null) return schema;
  return {
    ...schema,
    fields: Object.fromEntries(
      allowedFields
        .filter((field) => schema.fields[field])
        .map((field) => [field, schema.fields[field]]),
    ),
  };
}

function normalizeFields(fields) {
  if (fields == null) return null;
  if (Array.isArray(fields)) return fields;
  return String(fields).split(',').map((field) => field.trim()).filter(Boolean);
}

function combineCompiledFilters(...filters) {
  const active = filters.filter((filter) => filter?.sql);
  if (active.length === 0) return { sql: '', params: [] };

  return {
    sql: ` WHERE ${active.map((filter) => `(${filter.sql.replace(/^ WHERE /, '')})`).join(' AND ')}`,
    params: active.flatMap((filter) => filter.params),
  };
}

export class ItemsService extends BaseService {
  constructor(collection, options = {}) {
    super(options);
    this.collection = assertIdentifier(collection, 'collection name');
    this.schemaCache = options.schemaCache ?? defaultSchemaCache;
  }

  async getCollectionSchema(database = this.database) {
    const snapshot = this.schema ?? await this.schemaCache.get(database);
    const collectionSchema = snapshot?.collections?.[this.collection];
    if (!collectionSchema) {
      throw serviceError('COLLECTION_NOT_FOUND', `Unknown collection: ${this.collection}`);
    }
    return collectionSchema;
  }

  async resolvePermission(action) {
    const permissions = new PermissionsService({
      accountability: this.accountability,
      database: this.database,
      schema: this.schema,
      schemaCache: this.schemaCache,
      emitter: this.emitter,
      logger: this.logger,
    });
    return permissions.resolve(action, this.collection);
  }

  validatePayload(payload, schema, permission, { creating = false } = {}) {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      throw serviceError('INVALID_PAYLOAD', 'Payload must be an object');
    }

    const entries = Object.entries(payload);
    for (const [field] of entries) {
      const fieldSchema = schema.fields[field];
      if (!fieldSchema) throw serviceError('INVALID_PAYLOAD', `Unknown field: ${field}`, field);
      if (fieldSchema.readonly) throw serviceError('FIELD_READ_ONLY', `Field is read-only: ${field}`, field);
      if (permission.fields && !permission.fields.includes(field)) {
        throw serviceError('FORBIDDEN_FIELD', `Field is not allowed for ${permission.action}: ${field}`, field);
      }
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

  compileActionFilters(userFilter, permissionFilter, userSchema, fullSchema) {
    const permissionSql = compileFilter(permissionFilter, fullSchema);
    const userSql = compileFilter(userFilter, userSchema);
    return combineCompiledFilters(permissionSql, userSql);
  }

  async readMany(rawQuery = {}) {
    return (await this.readManyWithMeta(rawQuery)).data;
  }

  async readManyWithMeta(rawQuery = {}) {
    const schema = await this.getCollectionSchema();
    const permission = await this.resolvePermission('read');
    const accessSchema = schemaForFields(schema, permission.fields);
    const query = parseItemsQuery(rawQuery);
    const requestedFields = normalizeFields(query.fields);
    const selected = compileSelectFields(requestedFields, accessSchema);
    const filter = this.compileActionFilters(query.filter, permission.filter, accessSchema, schema);
    const sortSql = compileSort(query.sort, accessSchema);
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
    const schema = await this.getCollectionSchema();
    const permission = await this.resolvePermission('read');
    const accessSchema = schemaForFields(schema, permission.fields);
    const selected = compileSelectFields(normalizeFields(fields), accessSchema);
    const table = quoteIdentifier(this.collection, 'collection name');
    const primaryKey = schema.primary_key;
    const filter = combineCompiledFilters(
      compileFilter(permission.filter, schema),
      compileFilter({ [primaryKey]: { _eq: id } }, schema),
    );
    const [rows] = await this.database.query(
      `SELECT ${selected.sql} FROM ${table}${filter.sql} LIMIT 1`,
      filter.params,
    );
    return rows[0] ?? null;
  }

  async returnCreatedOrUpdated(id, schema) {
    try {
      return await this.readOne(id);
    } catch (error) {
      if (error?.code !== 'FORBIDDEN') throw error;
      return { [schema.primary_key]: id };
    }
  }

  async createOne(payload = {}) {
    const schema = await this.getCollectionSchema();
    const permission = await this.resolvePermission('create');
    const entries = this.validatePayload(payload, schema, permission, { creating: true });
    const id = randomUUID();
    const values = { [schema.primary_key]: id, ...Object.fromEntries(entries) };
    const fields = Object.keys(values);
    const table = quoteIdentifier(this.collection, 'collection name');

    await this.database.query(
      `INSERT INTO ${table} (${fields.map((field) => quoteIdentifier(field, 'field name')).join(', ')})
       VALUES (${fields.map(() => '?').join(', ')})`,
      fields.map((field) => values[field]),
    );

    return this.returnCreatedOrUpdated(id, schema);
  }

  async createMany(payloads = []) {
    if (!Array.isArray(payloads) || payloads.length === 0) {
      throw serviceError('INVALID_PAYLOAD', 'createMany requires a non-empty array');
    }

    const schema = await this.getCollectionSchema();
    const permission = await this.resolvePermission('create');
    const createdIds = [];

    await withTransaction(this.database, async (connection) => {
      const table = quoteIdentifier(this.collection, 'collection name');

      for (const payload of payloads) {
        const entries = this.validatePayload(payload, schema, permission, { creating: true });
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
    for (const id of createdIds) records.push(await this.returnCreatedOrUpdated(id, schema));
    return records;
  }

  async updateOne(id, payload = {}) {
    const schema = await this.getCollectionSchema();
    const permission = await this.resolvePermission('update');
    const entries = this.validatePayload(payload, schema, permission);
    if (entries.length === 0) throw serviceError('INVALID_PAYLOAD', 'Update payload cannot be empty');

    const accessSchema = schemaForFields(schema, permission.fields);
    const table = quoteIdentifier(this.collection, 'collection name');
    const setSql = entries.map(([field]) => `${quoteIdentifier(field, 'field name')} = ?`).join(', ');
    const filter = combineCompiledFilters(
      compileFilter(permission.filter, schema),
      compileFilter({ [schema.primary_key]: { _eq: id } }, schema),
    );
    const [result] = await this.database.query(
      `UPDATE ${table} SET ${setSql}${filter.sql}`,
      [...entries.map(([, value]) => value), ...filter.params],
    );

    if (result.affectedRows === 0) return null;
    void accessSchema;
    return this.returnCreatedOrUpdated(id, schema);
  }

  async updateMany(filterInput, payload = {}) {
    if (!filterInput || typeof filterInput !== 'object' || Array.isArray(filterInput) || Object.keys(filterInput).length === 0) {
      throw serviceError('FILTER_REQUIRED', 'updateMany requires an explicit non-empty filter');
    }

    const schema = await this.getCollectionSchema();
    const permission = await this.resolvePermission('update');
    const accessSchema = schemaForFields(schema, permission.fields);
    const entries = this.validatePayload(payload, schema, permission);
    if (entries.length === 0) throw serviceError('INVALID_PAYLOAD', 'Update payload cannot be empty');
    const filter = this.compileActionFilters(filterInput, permission.filter, accessSchema, schema);
    const table = quoteIdentifier(this.collection, 'collection name');
    const setSql = entries.map(([field]) => `${quoteIdentifier(field, 'field name')} = ?`).join(', ');
    const [result] = await this.database.query(
      `UPDATE ${table} SET ${setSql}${filter.sql}`,
      [...entries.map(([, value]) => value), ...filter.params],
    );
    return result.affectedRows;
  }

  async deleteOne(id) {
    const schema = await this.getCollectionSchema();
    const permission = await this.resolvePermission('delete');
    const table = quoteIdentifier(this.collection, 'collection name');
    const filter = combineCompiledFilters(
      compileFilter(permission.filter, schema),
      compileFilter({ [schema.primary_key]: { _eq: id } }, schema),
    );
    const [result] = await this.database.query(
      `DELETE FROM ${table}${filter.sql}`,
      filter.params,
    );
    return result.affectedRows > 0;
  }

  async deleteMany(filterInput) {
    if (!filterInput || typeof filterInput !== 'object' || Array.isArray(filterInput) || Object.keys(filterInput).length === 0) {
      throw serviceError('FILTER_REQUIRED', 'deleteMany requires an explicit non-empty filter');
    }

    const schema = await this.getCollectionSchema();
    const permission = await this.resolvePermission('delete');
    const accessSchema = schemaForFields(schema, permission.fields);
    const filter = this.compileActionFilters(filterInput, permission.filter, accessSchema, schema);
    const table = quoteIdentifier(this.collection, 'collection name');
    const [result] = await this.database.query(
      `DELETE FROM ${table}${filter.sql}`,
      filter.params,
    );
    return result.affectedRows;
  }
}
