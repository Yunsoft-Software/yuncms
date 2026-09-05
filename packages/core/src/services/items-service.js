import { randomUUID } from 'node:crypto';

import { assertIdentifier, quoteIdentifier } from '../identifier.js';
import { enforcePermissionValidation } from '../permission-validation.js';
import {
  assertQueryCost,
  compileAggregate,
  compileFilter,
  compileSearch,
  compileSelectFields,
  compileSort,
  parseItemsQuery,
  QUERY_LIMITS,
} from '../query.js';
import { SchemaCache } from '../schema.js';
import { isSystemManagedField, systemMutationEntries } from '../system-fields.js';
import { withTransaction } from '../transaction.js';
import { BaseService } from './base-service.js';
import { PermissionsService } from './permissions-service.js';

const defaultSchemaCache = new SchemaCache();
const MAX_BULK_VALIDATION_ROWS = 5000;

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

function createCandidateRecord(schema, id, entries, now = new Date()) {
  const provided = Object.fromEntries(entries);
  const candidate = {};

  for (const fieldSchema of Object.values(schema.fields)) {
    if (fieldSchema.field === schema.primary_key) {
      candidate[fieldSchema.field] = id;
      continue;
    }
    if (Object.hasOwn(provided, fieldSchema.field)) {
      candidate[fieldSchema.field] = provided[fieldSchema.field];
      continue;
    }
    const metadata = parseMetadata(fieldSchema.schema_metadata);
    if (metadata.defaultPreset === 'now') {
      candidate[fieldSchema.field] = now;
      continue;
    }
    candidate[fieldSchema.field] = Object.hasOwn(metadata, 'defaultValue')
      ? metadata.defaultValue
      : null;
  }

  return candidate;
}

function mergeSystemEntries(entries, schema, accountability, operation, now = new Date()) {
  return [...entries, ...systemMutationEntries(schema, accountability, operation, now)];
}

function databaseMutationValue(field, value, schema) {
  if (value == null) return value;
  const type = schema.fields[field]?.type;

  if (type === 'json') {
    if (typeof value === 'string') {
      try {
        JSON.parse(value);
        return value;
      } catch {
        return JSON.stringify(value);
      }
    }
    return JSON.stringify(value);
  }

  if (
    (type === 'datetime' || type === 'timestamp')
    && typeof value === 'string'
    && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/u.test(value)
  ) {
    const date = new Date(value);
    if (!Number.isNaN(date.getTime())) return date;
  }

  return value;
}

function databaseMutationParams(entries, schema) {
  return entries.map(([field, value]) => databaseMutationValue(field, value, schema));
}

export class ItemsService extends BaseService {
  constructor(collection, options = {}) {
    super(options);
    this.collection = assertIdentifier(collection, 'collection name');
    this.schemaCache = options.schemaCache ?? defaultSchemaCache;
  }

  hookContext(extra = {}) {
    return {
      accountability: this.accountability,
      collection: this.collection,
      requestId: this.requestId,
      ...extra,
    };
  }

  async filterMutation(event, payload, context = {}) {
    if (!this.emitter) return payload;
    return this.emitter.filter(event, payload, this.hookContext(context));
  }

  async actionMutation(event, payload, context = {}) {
    if (!this.emitter) return;
    await this.emitter.action(event, payload, this.hookContext(context));
  }

  async getCollectionSchema(database = this.database) {
    const snapshot = this.schema ?? await this.schemaCache.get(database);
    const collectionSchema = snapshot?.collections?.[this.collection];
    if (!collectionSchema) {
      throw serviceError('COLLECTION_NOT_FOUND', `Unknown collection: ${this.collection}`);
    }
    if (collectionSchema.system) {
      throw serviceError(
        'SYSTEM_COLLECTION_USE_DEDICATED_SERVICE',
        `System collection ${this.collection} must be accessed through its dedicated service`,
      );
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
      permissionCache: this.permissionCache,
      requestId: this.requestId,
    });
    return permissions.resolve(action, this.collection);
  }

  dynamicVariables(now = new Date()) {
    return {
      user: this.accountability.user,
      role: this.accountability.role,
      now,
    };
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
        if (isSystemManagedField(fieldSchema)) continue;
        const metadata = parseMetadata(fieldSchema.schema_metadata);
        if (Object.hasOwn(metadata, 'defaultValue') || metadata.defaultPreset != null) continue;
        throw serviceError('REQUIRED_FIELD_MISSING', `Required field is missing: ${fieldSchema.field}`, fieldSchema.field);
      }
    }

    return entries;
  }

  compileActionFilters(userFilter, permissionFilter, userSchema, fullSchema, search = null, dynamicVariables = this.dynamicVariables()) {
    const permissionSql = compileFilter(permissionFilter, fullSchema, { dynamicVariables });
    const userSql = compileFilter(userFilter, userSchema, { dynamicVariables });
    const searchSql = compileSearch(search, userSchema);
    return combineCompiledFilters(permissionSql, userSql, searchSql);
  }

  async normalizeReadQuery(rawQuery) {
    const parsed = parseItemsQuery(rawQuery);
    const filtered = this.emitter
      ? await this.emitter.filter('items.query', parsed, this.hookContext({ operation: 'read' }))
      : parsed;
    const query = parseItemsQuery(filtered);
    assertQueryCost(query);
    return query;
  }

  async emitReadAction(query, rows, schema, { single = false } = {}) {
    if (!this.emitter) return;
    const primaryKey = schema.primary_key;
    const keys = rows
      .filter((row) => row && Object.hasOwn(row, primaryKey))
      .map((row) => row[primaryKey])
      .slice(0, QUERY_LIMITS.maxLimit);
    await this.emitter.action('items.read', {
      collection: this.collection,
      query,
      keys,
      count: rows.length,
      single,
    }, this.hookContext({ operation: 'read' }));
  }

  async readMany(rawQuery = {}) {
    return (await this.readManyWithMeta(rawQuery)).data;
  }

  async readManyWithMeta(rawQuery = {}) {
    const schema = await this.getCollectionSchema();
    const query = await this.normalizeReadQuery(rawQuery);
    const permission = await this.resolvePermission('read');
    const accessSchema = schemaForFields(schema, permission.fields);
    const filter = this.compileActionFilters(
      query.filter,
      permission.filter,
      accessSchema,
      schema,
      query.search,
      this.dynamicVariables(),
    );
    const table = quoteIdentifier(this.collection, 'collection name');
    const aggregate = compileAggregate(query.aggregate, query.groupBy, accessSchema);

    if (aggregate) {
      const sortSql = compileSort(query.sort, accessSchema);
      const [rows] = await this.database.query(
        `SELECT ${aggregate.sql} FROM ${table}${filter.sql}${aggregate.groupSql}${sortSql} LIMIT ? OFFSET ?`,
        [...filter.params, query.limit, query.offset],
      );
      await this.emitReadAction(query, rows, schema);
      return {
        data: rows,
        meta: {
          total_count: rows.length,
          limit: query.limit,
          offset: query.offset,
          aggregate: true,
        },
      };
    }

    const requestedFields = normalizeFields(query.fields);
    const selected = compileSelectFields(requestedFields, accessSchema);
    const sortSql = compileSort(query.sort, accessSchema);
    const [rows] = await this.database.query(
      `SELECT ${selected.sql} FROM ${table}${filter.sql}${sortSql} LIMIT ? OFFSET ?`,
      [...filter.params, query.limit, query.offset],
    );
    const [countRows] = await this.database.query(
      `SELECT COUNT(*) AS total_count FROM ${table}${filter.sql}`,
      filter.params,
    );
    await this.emitReadAction(query, rows, schema);

    return {
      data: rows,
      meta: {
        total_count: Number(countRows?.[0]?.total_count ?? 0),
        limit: query.limit,
        offset: query.offset,
      },
    };
  }

  async readManyForRelation({ fields = null, lookupField, values = [] } = {}) {
    const schema = await this.getCollectionSchema();
    const trustedLookupField = assertIdentifier(lookupField, 'relation lookup field');
    if (!schema.fields[trustedLookupField]) {
      throw serviceError('INVALID_QUERY', `Unknown relation lookup field: ${trustedLookupField}`, trustedLookupField);
    }
    if (!Array.isArray(values) || values.length === 0 || values.length > QUERY_LIMITS.maxLimit) {
      throw serviceError(
        'INVALID_QUERY',
        `Relation lookup values must contain between 1 and ${QUERY_LIMITS.maxLimit} entries`,
        trustedLookupField,
      );
    }

    const permission = await this.resolvePermission('read');
    const accessSchema = schemaForFields(schema, permission.fields);
    const visibleSelection = compileSelectFields(normalizeFields(fields), accessSchema);
    const internalSchema = {
      ...accessSchema,
      fields: { ...accessSchema.fields, [trustedLookupField]: schema.fields[trustedLookupField] },
    };
    const internalSelection = compileSelectFields([...visibleSelection.fields, trustedLookupField], internalSchema);
    const dynamicVariables = this.dynamicVariables();
    const permissionFilter = compileFilter(permission.filter, schema, { dynamicVariables });
    const table = quoteIdentifier(this.collection, 'collection name');
    const data = [];

    for (let offset = 0; offset < values.length; offset += QUERY_LIMITS.maxInValues) {
      const chunk = values.slice(offset, offset + QUERY_LIMITS.maxInValues);
      const filter = combineCompiledFilters(
        permissionFilter,
        compileFilter({ [trustedLookupField]: { _in: chunk } }, schema),
      );
      const [rows] = await this.database.query(
        `SELECT ${internalSelection.sql} FROM ${table}${filter.sql} LIMIT ?`,
        [...filter.params, chunk.length],
      );
      data.push(...rows);
    }

    return { data, visibleFields: visibleSelection.fields };
  }

  async readOne(id, { fields = null } = {}) {
    const schema = await this.getCollectionSchema();
    const permission = await this.resolvePermission('read');
    const accessSchema = schemaForFields(schema, permission.fields);
    const selected = compileSelectFields(normalizeFields(fields), accessSchema);
    const table = quoteIdentifier(this.collection, 'collection name');
    const primaryKey = schema.primary_key;
    const dynamicVariables = this.dynamicVariables();
    const filter = combineCompiledFilters(
      compileFilter(permission.filter, schema, { dynamicVariables }),
      compileFilter({ [primaryKey]: { _eq: id } }, schema),
    );
    const [rows] = await this.database.query(
      `SELECT ${selected.sql} FROM ${table}${filter.sql} LIMIT 1`,
      filter.params,
    );
    const record = rows[0] ?? null;
    if (record) await this.emitReadAction({ fields: normalizeFields(fields) }, [record], schema, { single: true });
    return record;
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
    const filteredPayload = await this.filterMutation('items.create', payload, { operation: 'create' });
    const callerEntries = this.validatePayload(filteredPayload, schema, permission, { creating: true });
    const now = new Date();
    const entries = mergeSystemEntries(callerEntries, schema, this.accountability, 'create', now);
    const id = randomUUID();
    const candidate = createCandidateRecord(schema, id, entries, now);
    enforcePermissionValidation(candidate, permission.validation, schema, {
      dynamicVariables: this.dynamicVariables(now),
    });

    const values = { [schema.primary_key]: id, ...Object.fromEntries(entries) };
    const fields = Object.keys(values);
    const table = quoteIdentifier(this.collection, 'collection name');
    await this.database.query(
      `INSERT INTO ${table} (${fields.map((field) => quoteIdentifier(field, 'field name')).join(', ')})\n       VALUES (${fields.map(() => '?').join(', ')})`,
      databaseMutationParams(fields.map((field) => [field, values[field]]), schema),
    );

    const record = await this.returnCreatedOrUpdated(id, schema);
    await this.actionMutation('items.create', { key: id, item: record }, { operation: 'create' });
    return record;
  }

  async createMany(payloads = []) {
    if (!Array.isArray(payloads) || payloads.length === 0) {
      throw serviceError('INVALID_PAYLOAD', 'createMany requires a non-empty array');
    }

    const schema = await this.getCollectionSchema();
    const permission = await this.resolvePermission('create');
    const staged = [];
    const now = new Date();

    for (const payload of payloads) {
      const filteredPayload = await this.filterMutation('items.create', payload, { operation: 'create', bulk: true });
      const callerEntries = this.validatePayload(filteredPayload, schema, permission, { creating: true });
      const entries = mergeSystemEntries(callerEntries, schema, this.accountability, 'create', now);
      const id = randomUUID();
      const candidate = createCandidateRecord(schema, id, entries, now);
      enforcePermissionValidation(candidate, permission.validation, schema, {
        dynamicVariables: this.dynamicVariables(now),
      });
      staged.push({ id, values: { [schema.primary_key]: id, ...Object.fromEntries(entries) } });
    }

    await withTransaction(this.database, async (connection) => {
      const table = quoteIdentifier(this.collection, 'collection name');
      for (const entry of staged) {
        const fields = Object.keys(entry.values);
        await connection.query(
          `INSERT INTO ${table} (${fields.map((field) => quoteIdentifier(field, 'field name')).join(', ')})\n           VALUES (${fields.map(() => '?').join(', ')})`,
          databaseMutationParams(
            fields.map((field) => [field, entry.values[field]]),
            schema,
          ),
        );
      }
    });

    const records = [];
    for (const entry of staged) {
      const record = await this.returnCreatedOrUpdated(entry.id, schema);
      records.push(record);
      await this.actionMutation('items.create', { key: entry.id, item: record }, { operation: 'create', bulk: true });
    }
    return records;
  }

  async updateOne(id, payload = {}) {
    const schema = await this.getCollectionSchema();
    const permission = await this.resolvePermission('update');
    const filteredPayload = await this.filterMutation('items.update', payload, { operation: 'update', key: id });
    const callerEntries = this.validatePayload(filteredPayload, schema, permission);
    if (callerEntries.length === 0) throw serviceError('INVALID_PAYLOAD', 'Update payload cannot be empty');
    const now = new Date();
    const dynamicVariables = this.dynamicVariables(now);
    const entries = mergeSystemEntries(callerEntries, schema, this.accountability, 'update', now);
    const effectiveChanges = Object.fromEntries(entries);
    const table = quoteIdentifier(this.collection, 'collection name');
    const filter = combineCompiledFilters(
      compileFilter(permission.filter, schema, { dynamicVariables }),
      compileFilter({ [schema.primary_key]: { _eq: id } }, schema),
    );

    if (permission.validation) {
      const [currentRows] = await this.database.query(`SELECT * FROM ${table}${filter.sql} LIMIT 1`, filter.params);
      const current = currentRows[0];
      if (!current) return null;
      enforcePermissionValidation({ ...current, ...effectiveChanges }, permission.validation, schema, { dynamicVariables });
    }

    const setSql = entries.map(([field]) => `${quoteIdentifier(field, 'field name')} = ?`).join(', ');
    const [result] = await this.database.query(
      `UPDATE ${table} SET ${setSql}${filter.sql}`,
      [...databaseMutationParams(entries, schema), ...filter.params],
    );
    if (result.affectedRows === 0) return null;
    const record = await this.returnCreatedOrUpdated(id, schema);
    await this.actionMutation('items.update', { key: id, item: record, changes: effectiveChanges }, { operation: 'update' });
    return record;
  }

  async updateMany(filterInput, payload = {}) {
    if (!filterInput || typeof filterInput !== 'object' || Array.isArray(filterInput) || Object.keys(filterInput).length === 0) {
      throw serviceError('FILTER_REQUIRED', 'updateMany requires an explicit non-empty filter');
    }

    const schema = await this.getCollectionSchema();
    const permission = await this.resolvePermission('update');
    const accessSchema = schemaForFields(schema, permission.fields);
    const filteredPayload = await this.filterMutation('items.update', payload, { operation: 'update', bulk: true, filter: filterInput });
    const callerEntries = this.validatePayload(filteredPayload, schema, permission);
    if (callerEntries.length === 0) throw serviceError('INVALID_PAYLOAD', 'Update payload cannot be empty');
    const now = new Date();
    const dynamicVariables = this.dynamicVariables(now);
    const entries = mergeSystemEntries(callerEntries, schema, this.accountability, 'update', now);
    const effectiveChanges = Object.fromEntries(entries);
    const filter = this.compileActionFilters(filterInput, permission.filter, accessSchema, schema, null, dynamicVariables);
    const table = quoteIdentifier(this.collection, 'collection name');

    if (permission.validation) {
      const [rows] = await this.database.query(
        `SELECT * FROM ${table}${filter.sql} LIMIT ?`,
        [...filter.params, MAX_BULK_VALIDATION_ROWS + 1],
      );
      if (rows.length > MAX_BULK_VALIDATION_ROWS) {
        throw serviceError('VALIDATION_BULK_LIMIT', `Permission validation can inspect at most ${MAX_BULK_VALIDATION_ROWS} rows per bulk update`);
      }
      for (const row of rows) {
        enforcePermissionValidation({ ...row, ...effectiveChanges }, permission.validation, schema, { dynamicVariables });
      }
    }

    const setSql = entries.map(([field]) => `${quoteIdentifier(field, 'field name')} = ?`).join(', ');
    const [result] = await this.database.query(
      `UPDATE ${table} SET ${setSql}${filter.sql}`,
      [...databaseMutationParams(entries, schema), ...filter.params],
    );
    await this.actionMutation('items.update', { filter: filterInput, changes: effectiveChanges, affected: result.affectedRows }, { operation: 'update', bulk: true });
    return result.affectedRows;
  }

  async deleteOne(id) {
    const schema = await this.getCollectionSchema();
    const permission = await this.resolvePermission('delete');
    const filtered = await this.filterMutation('items.delete', { key: id }, { operation: 'delete', key: id });
    const key = filtered?.key ?? id;
    const table = quoteIdentifier(this.collection, 'collection name');
    const dynamicVariables = this.dynamicVariables();
    const filter = combineCompiledFilters(
      compileFilter(permission.filter, schema, { dynamicVariables }),
      compileFilter({ [schema.primary_key]: { _eq: key } }, schema),
    );
    const [result] = await this.database.query(`DELETE FROM ${table}${filter.sql}`, filter.params);
    const deleted = result.affectedRows > 0;
    if (deleted) await this.actionMutation('items.delete', { key }, { operation: 'delete' });
    return deleted;
  }

  async deleteMany(filterInput) {
    if (!filterInput || typeof filterInput !== 'object' || Array.isArray(filterInput) || Object.keys(filterInput).length === 0) {
      throw serviceError('FILTER_REQUIRED', 'deleteMany requires an explicit non-empty filter');
    }

    const schema = await this.getCollectionSchema();
    const permission = await this.resolvePermission('delete');
    const accessSchema = schemaForFields(schema, permission.fields);
    const filtered = await this.filterMutation('items.delete', { filter: filterInput }, { operation: 'delete', bulk: true });
    const effectiveFilter = filtered?.filter ?? filterInput;
    if (!effectiveFilter || typeof effectiveFilter !== 'object' || Array.isArray(effectiveFilter) || Object.keys(effectiveFilter).length === 0) {
      throw serviceError('FILTER_REQUIRED', 'deleteMany hook result must preserve a non-empty filter');
    }
    const filter = this.compileActionFilters(effectiveFilter, permission.filter, accessSchema, schema);
    const table = quoteIdentifier(this.collection, 'collection name');
    const [result] = await this.database.query(`DELETE FROM ${table}${filter.sql}`, filter.params);
    await this.actionMutation('items.delete', { filter: effectiveFilter, affected: result.affectedRows }, { operation: 'delete', bulk: true });
    return result.affectedRows;
  }
}

export { MAX_BULK_VALIDATION_ROWS, createCandidateRecord };
