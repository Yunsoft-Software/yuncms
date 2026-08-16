import { randomUUID } from 'node:crypto';

import { compileFilter } from '../query.js';
import { SchemaCache } from '../schema.js';
import { BaseService } from './base-service.js';

const ACTIONS = new Set(['create', 'read', 'update', 'delete']);
const defaultSchemaCache = new SchemaCache();

function parseJson(value, fallback = null) {
  if (value == null) return fallback;
  if (typeof value === 'object') return value;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function forbidden(message) {
  const error = new Error(message);
  error.code = 'FORBIDDEN';
  return error;
}

function assertAction(action) {
  if (!ACTIONS.has(action)) {
    const error = new Error(`Unsupported permission action: ${String(action)}`);
    error.code = 'INVALID_PERMISSION';
    throw error;
  }
  return action;
}

function assertPermissionManager(accountability) {
  if (accountability.admin === true || accountability.system === true) return;
  throw forbidden('Permission management requires administrator accountability');
}

export class PermissionsService extends BaseService {
  constructor(options = {}) {
    super(options);
    this.schemaCache = options.schemaCache ?? defaultSchemaCache;
  }

  async resolve(action, collection) {
    assertAction(action);

    if (this.accountability.admin === true || this.accountability.system === true) {
      return {
        fullAccess: true,
        role: this.accountability.role,
        collection,
        action,
        fields: null,
        filter: null,
        validation: null,
      };
    }

    if (!this.accountability.role) {
      throw forbidden(`No role is available for ${action} access to ${collection}`);
    }

    const [rows] = await this.database.query(
      `SELECT id, role, collection, action, fields, filter, validation
       FROM yuncms_permissions
       WHERE role = ? AND collection = ? AND action = ?
       LIMIT 1`,
      [this.accountability.role, collection, action],
    );
    const row = rows[0];
    if (!row) throw forbidden(`Role has no ${action} permission for ${collection}`);

    const fields = parseJson(row.fields, null);
    const filter = parseJson(row.filter, null);
    const validation = parseJson(row.validation, null);

    if (fields !== null && (!Array.isArray(fields) || fields.some((field) => typeof field !== 'string'))) {
      const error = new Error(`Permission ${row.id} contains invalid field metadata`);
      error.code = 'INVALID_PERMISSION';
      throw error;
    }

    return {
      fullAccess: false,
      id: row.id,
      role: row.role,
      collection: row.collection,
      action: row.action,
      fields,
      filter,
      validation,
    };
  }

  async readMany() {
    assertPermissionManager(this.accountability);
    const [rows] = await this.database.query(
      `SELECT id, role, collection, action, fields, filter, validation, created_at, updated_at
       FROM yuncms_permissions
       ORDER BY role, collection, action`,
    );
    return rows;
  }

  async createOne(input = {}) {
    assertPermissionManager(this.accountability);
    const action = assertAction(input.action);
    if (!input.role) {
      const error = new Error('Permission role is required');
      error.code = 'INVALID_PERMISSION';
      throw error;
    }
    if (!input.collection || typeof input.collection !== 'string') {
      const error = new Error('Permission collection is required');
      error.code = 'INVALID_PERMISSION';
      throw error;
    }
    if (input.validation != null) {
      const error = new Error('Permission validation rules are not enforced yet and cannot be stored in V1');
      error.code = 'PERMISSION_VALIDATION_NOT_READY';
      throw error;
    }

    const snapshot = this.schema ?? await this.schemaCache.get(this.database);
    const collectionSchema = snapshot.collections?.[input.collection];
    if (!collectionSchema) {
      const error = new Error(`Unknown permission collection: ${input.collection}`);
      error.code = 'COLLECTION_NOT_FOUND';
      throw error;
    }

    let fields = input.fields ?? null;
    if (fields !== null) {
      if (!Array.isArray(fields) || fields.length === 0) {
        const error = new Error('Permission fields must be a non-empty array or null');
        error.code = 'INVALID_PERMISSION';
        throw error;
      }
      fields = [...new Set(fields)];
      for (const field of fields) {
        if (!collectionSchema.fields?.[field]) {
          const error = new Error(`Unknown permission field: ${field}`);
          error.code = 'INVALID_PERMISSION';
          throw error;
        }
      }
    }

    const filter = input.filter ?? null;
    if (filter !== null) compileFilter(filter, collectionSchema);

    const [roleRows] = await this.database.query(
      'SELECT id FROM yuncms_roles WHERE id = ? LIMIT 1',
      [input.role],
    );
    if (!roleRows[0]) {
      const error = new Error(`Unknown permission role: ${input.role}`);
      error.code = 'ROLE_NOT_FOUND';
      throw error;
    }

    const id = randomUUID();
    await this.database.query(
      `INSERT INTO yuncms_permissions (id, role, collection, action, fields, filter, validation)
       VALUES (?, ?, ?, ?, ?, ?, NULL)`,
      [
        id,
        input.role,
        input.collection,
        action,
        fields == null ? null : JSON.stringify(fields),
        filter == null ? null : JSON.stringify(filter),
      ],
    );

    const [rows] = await this.database.query(
      `SELECT id, role, collection, action, fields, filter, validation, created_at, updated_at
       FROM yuncms_permissions WHERE id = ? LIMIT 1`,
      [id],
    );
    return rows[0] ?? null;
  }
}
