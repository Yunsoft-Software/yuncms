import { randomUUID } from 'node:crypto';

import { assertPermissionValidationRule } from '../permission-validation.js';
import { compileFilter } from '../query.js';
import { SchemaCache } from '../schema.js';
import {
  assertSystemPermissionPayload,
  assertSystemResourceAction,
  isPermissionManagedSystemResource,
} from '../system-permissions.js';
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

function normalizePermissionFields(fields, collectionSchema) {
  if (fields == null) return null;
  if (!Array.isArray(fields) || fields.length === 0) {
    const error = new Error('Permission fields must be a non-empty array or null');
    error.code = 'INVALID_PERMISSION';
    throw error;
  }

  const normalized = [...new Set(fields)];
  for (const field of normalized) {
    if (typeof field !== 'string' || !collectionSchema.fields?.[field]) {
      const error = new Error(`Unknown permission field: ${String(field)}`);
      error.code = 'INVALID_PERMISSION';
      throw error;
    }
  }
  return normalized;
}

function normalizePermissionRow(row) {
  if (!row) return null;
  return {
    ...row,
    fields: parseJson(row.fields, null),
    filter: parseJson(row.filter, null),
    validation: parseJson(row.validation, null),
  };
}

function cacheKey(accountability, action, collection) {
  return [
    accountability.system === true ? 'system' : accountability.admin === true ? 'admin' : accountability.role ?? 'none',
    collection,
    action,
  ].join(':');
}

export class PermissionsService extends BaseService {
  constructor(options = {}) {
    super(options);
    this.schemaCache = options.schemaCache ?? defaultSchemaCache;
  }

  async action(event, payload) {
    if (!this.emitter) return;
    await this.emitter.action(event, payload, {
      accountability: this.accountability,
      requestId: this.requestId,
      collection: 'yuncms_permissions',
    });
  }

  async #collectionSchema(collection) {
    const snapshot = this.schema ?? await this.schemaCache.get(this.database);
    const collectionSchema = snapshot.collections?.[collection];
    if (!collectionSchema) {
      const error = new Error(`Unknown permission collection: ${collection}`);
      error.code = 'COLLECTION_NOT_FOUND';
      throw error;
    }
    return collectionSchema;
  }

  async resolve(action, collection) {
    assertAction(action);
    const key = cacheKey(this.accountability, action, collection);
    if (this.permissionCache) {
      const cached = await this.permissionCache.get(key);
      if (cached !== undefined) return cached;
    }

    let permission;
    if (this.accountability.admin === true || this.accountability.system === true) {
      permission = {
        fullAccess: true,
        role: this.accountability.role,
        collection,
        action,
        fields: null,
        filter: null,
        validation: null,
      };
    } else {
      if (!this.accountability.role) {
        throw forbidden(`No role is available for ${action} access to ${collection}`);
      }

      const collectionSchema = await this.#collectionSchema(collection);
      if (collectionSchema.system) {
        if (!isPermissionManagedSystemResource(collectionSchema)) {
          throw forbidden(`System resource is not delegatable: ${collection}`);
        }
        try {
          assertSystemResourceAction(collectionSchema, action);
        } catch (error) {
          if (error.code === 'SYSTEM_PERMISSION_ACTION_PROTECTED') throw forbidden(error.message);
          throw error;
        }
      }

      const [rows] = await this.database.query(
        `SELECT id, role, collection, action, fields, filter, validation
         FROM yuncms_permissions
         WHERE role = ? AND collection = ? AND action = ?
         LIMIT 1`,
        [this.accountability.role, collection, action],
      );
      const row = normalizePermissionRow(rows[0]);
      if (!row) throw forbidden(`Role has no ${action} permission for ${collection}`);

      if (row.fields !== null && (!Array.isArray(row.fields) || row.fields.some((field) => typeof field !== 'string'))) {
        const error = new Error(`Permission ${row.id} contains invalid field metadata`);
        error.code = 'INVALID_PERMISSION';
        throw error;
      }

      permission = {
        fullAccess: false,
        id: row.id,
        role: row.role,
        collection: row.collection,
        action: row.action,
        fields: row.fields,
        filter: row.filter,
        validation: row.validation,
      };
    }

    if (this.permissionCache) await this.permissionCache.set(key, permission);
    return permission;
  }

  async readMany() {
    assertPermissionManager(this.accountability);
    const [rows] = await this.database.query(
      `SELECT id, role, collection, action, fields, filter, validation, created_at, updated_at
       FROM yuncms_permissions
       ORDER BY role, collection, action`,
    );
    return rows.map(normalizePermissionRow);
  }

  async readOne(id) {
    assertPermissionManager(this.accountability);
    const [rows] = await this.database.query(
      `SELECT id, role, collection, action, fields, filter, validation, created_at, updated_at
       FROM yuncms_permissions WHERE id = ? LIMIT 1`,
      [id],
    );
    return normalizePermissionRow(rows[0]);
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

    const collectionSchema = await this.#collectionSchema(input.collection);
    if (collectionSchema.system) {
      if (!isPermissionManagedSystemResource(collectionSchema)) {
        const error = new Error(`System resource permissions are protected: ${input.collection}`);
        error.code = 'SYSTEM_PERMISSION_RESOURCE_PROTECTED';
        throw error;
      }
      assertSystemResourceAction(collectionSchema, action);
      assertSystemPermissionPayload(collectionSchema, action, input);
    }

    const fields = normalizePermissionFields(input.fields ?? null, collectionSchema);
    const filter = input.filter ?? null;
    const validation = input.validation ?? null;
    if (filter !== null) compileFilter(filter, collectionSchema);
    assertPermissionValidationRule(validation, collectionSchema);

    const [roleRows] = await this.database.query(
      'SELECT id, admin, public FROM yuncms_roles WHERE id = ? LIMIT 1',
      [input.role],
    );
    const role = roleRows[0];
    if (!role) {
      const error = new Error(`Unknown permission role: ${input.role}`);
      error.code = 'ROLE_NOT_FOUND';
      throw error;
    }

    const id = randomUUID();
    await this.database.query(
      `INSERT INTO yuncms_permissions (id, role, collection, action, fields, filter, validation)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        input.role,
        input.collection,
        action,
        fields == null ? null : JSON.stringify(fields),
        filter == null ? null : JSON.stringify(filter),
        validation == null ? null : JSON.stringify(validation),
      ],
    );
    if (this.permissionCache) await this.permissionCache.clear();
    const permission = await this.readOne(id);
    await this.action('permissions.create', { key: id, item: permission });
    return permission;
  }

  async updateOne(id, patch = {}) {
    assertPermissionManager(this.accountability);
    if (!patch || typeof patch !== 'object' || Array.isArray(patch)) {
      const error = new Error('Permission patch must be an object');
      error.code = 'INVALID_PERMISSION';
      throw error;
    }
    const keys = Object.keys(patch);
    if (keys.length === 0 || keys.some((key) => !['fields', 'filter', 'validation'].includes(key))) {
      const error = new Error('Permission update supports fields, filter and validation only');
      error.code = 'INVALID_PERMISSION';
      throw error;
    }

    const existing = await this.readOne(id);
    if (!existing) {
      const error = new Error(`Unknown permission: ${id}`);
      error.code = 'PERMISSION_NOT_FOUND';
      throw error;
    }
    const collectionSchema = await this.#collectionSchema(existing.collection);
    if (collectionSchema.system) {
      assertSystemPermissionPayload(collectionSchema, existing.action, patch);
    }

    const assignments = [];
    const params = [];
    if (Object.hasOwn(patch, 'fields')) {
      const fields = normalizePermissionFields(patch.fields, collectionSchema);
      assignments.push('fields = ?');
      params.push(fields == null ? null : JSON.stringify(fields));
    }
    if (Object.hasOwn(patch, 'filter')) {
      if (patch.filter != null) compileFilter(patch.filter, collectionSchema);
      assignments.push('filter = ?');
      params.push(patch.filter == null ? null : JSON.stringify(patch.filter));
    }
    if (Object.hasOwn(patch, 'validation')) {
      assertPermissionValidationRule(patch.validation, collectionSchema);
      assignments.push('validation = ?');
      params.push(patch.validation == null ? null : JSON.stringify(patch.validation));
    }

    params.push(id);
    await this.database.query(
      `UPDATE yuncms_permissions SET ${assignments.join(', ')} WHERE id = ?`,
      params,
    );
    if (this.permissionCache) await this.permissionCache.clear();
    const permission = await this.readOne(id);
    await this.action('permissions.update', {
      key: id,
      before: existing,
      item: permission,
      changes: patch,
    });
    return permission;
  }

  async deleteOne(id) {
    assertPermissionManager(this.accountability);
    const before = this.emitter ? await this.readOne(id) : null;
    const [result] = await this.database.query(
      'DELETE FROM yuncms_permissions WHERE id = ?',
      [id],
    );
    if (result.affectedRows !== 1) {
      const error = new Error(`Unknown permission: ${id}`);
      error.code = 'PERMISSION_NOT_FOUND';
      throw error;
    }
    if (this.permissionCache) await this.permissionCache.clear();
    await this.action('permissions.delete', { key: id, before });
    return true;
  }
}

export { cacheKey };
