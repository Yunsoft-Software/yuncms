import { randomUUID } from 'node:crypto';
import { assertIdentifier, quoteIdentifier } from '../identifier.js';
import { readNativeReferenceRows } from '../native-reference.js';

import { assertPasswordInput, hashPassword } from '../auth/password.js';
import {
  buildSystemListQuery,
  USER_SAFE_SELECT_COLUMNS,
  USER_SYSTEM_SEARCH_SCHEMA,
} from '../system-list-query.js';
import { dispatchAfterCommit, transactionContext, withTransaction } from '../transaction.js';
import { BaseService } from './base-service.js';
import { resolveSystemResourceAccess } from './system-resource-access.js';

const USER_STATUSES = new Set(['active', 'suspended', 'disabled']);
const USER_UPDATE_KEYS = new Set(['email', 'role', 'status']);
const PUBLIC_REGISTRATION_KEYS = new Set(['email', 'password']);
const PROTECTED_USER_COLUMNS = new Set([
  ...USER_SAFE_SELECT_COLUMNS,
  'password_hash',
]);

function parseFieldMetadata(value) {
  if (value == null || typeof value === 'object') return value ?? {};
  try {
    return JSON.parse(value);
  } catch {
    return {};
  }
}

export function getCustomUserFields(schema) {
  const fields = schema?.collections?.yuncms_users?.fields;
  if (!fields || typeof fields !== 'object') return [];
  return Object.values(fields).filter((field) => {
    if (!field?.field || PROTECTED_USER_COLUMNS.has(field.field)) return false;
    return parseFieldMetadata(field.schema_metadata).systemExtension === true;
  });
}

function serializeCustomUserValue(fieldSchema, value) {
  if (value == null) return null;
  const type = fieldSchema.type;
  if (type === 'boolean') {
    return typeof value === 'boolean' ? (value ? 1 : 0) : value;
  }
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

function normalizeEmail(email) {
  if (typeof email !== 'string') {
    const error = new Error('Email is required');
    error.code = 'INVALID_PAYLOAD';
    throw error;
  }
  const normalized = email.trim().toLowerCase();
  if (!normalized || normalized.length > 191 || !normalized.includes('@')) {
    const error = new Error('Email is invalid');
    error.code = 'INVALID_PAYLOAD';
    throw error;
  }
  return normalized;
}

function forbidden(message) {
  const error = new Error(message);
  error.code = 'FORBIDDEN';
  return error;
}

function invalid(message) {
  const error = new Error(message);
  error.code = 'INVALID_PAYLOAD';
  return error;
}

function assertStatus(status) {
  if (!USER_STATUSES.has(status)) {
    const error = new Error(`Unsupported user status: ${status}`);
    error.code = 'INVALID_PAYLOAD';
    throw error;
  }
  return status;
}

function assertCredentialManager(accountability) {
  if (accountability.admin === true || accountability.system === true) return;
  throw forbidden('Changing another user password requires administrator accountability');
}

async function assertRoleAssignable(database, role, accountability) {
  if (role == null) return;
  const [roleRows] = await database.query(
    'SELECT id, admin, public FROM yuncms_roles WHERE id = ? LIMIT 1',
    [role],
  );
  const targetRole = roleRows[0];
  if (!targetRole) {
    const error = new Error(`Unknown role: ${role}`);
    error.code = 'ROLE_NOT_FOUND';
    throw error;
  }
  if (targetRole.public) {
    const error = new Error('The public role cannot be assigned to an authenticated user');
    error.code = 'INVALID_ROLE';
    throw error;
  }
  if (targetRole.admin && accountability.admin !== true && accountability.system !== true) {
    throw forbidden('Only an administrator can assign the administrator role');
  }
  if (
    accountability.admin !== true
    && accountability.system !== true
    && role !== accountability.role
  ) {
    throw forbidden('Delegated user managers may assign only their own role');
  }
}

async function assertTargetManageable(database, id, accountability) {
  if (accountability.admin === true || accountability.system === true) return;
  const [rows] = await database.query(
    `SELECT u.id, r.admin AS role_admin
     FROM yuncms_users u
     LEFT JOIN yuncms_roles r ON r.id = u.role
     WHERE u.id = ?
     LIMIT 1`,
    [id],
  );
  if (!rows[0]) {
    const error = new Error(`Unknown user: ${id}`);
    error.code = 'USER_NOT_FOUND';
    throw error;
  }
  if (rows[0].role_admin) throw forbidden('Delegated user managers cannot modify administrator accounts');
}

export class UsersService extends BaseService {
  async readManyForRelation(query) {
    const permission = await resolveSystemResourceAccess(this, 'read', 'yuncms_users');
    return readNativeReferenceRows(this, 'yuncms_users', permission, query);
  }

  async action(event, payload) {
    if (!this.emitter) return;
    await dispatchAfterCommit(this.database, (database, transaction) => this.emitter.action(event, payload, {
      accountability: this.accountability,
      requestId: this.requestId,
      collection: 'yuncms_users',
      database,
      transaction,
    }));
  }

  #customFields() {
    return getCustomUserFields(this.schema);
  }

  #selectColumnList() {
    const custom = this.#customFields();
    if (custom.length === 0) return USER_SAFE_SELECT_COLUMNS;
    return [
      ...USER_SAFE_SELECT_COLUMNS,
      ...custom.map((field) => assertIdentifier(field.field, 'field name')),
    ];
  }

  #selectColumnsSql() {
    const custom = this.#customFields();
    if (custom.length === 0) {
      return 'id, email, role, status, email_verified_at, last_access, created_at, updated_at';
    }
    return [
      ...USER_SAFE_SELECT_COLUMNS,
      ...custom.map((field) => quoteIdentifier(field.field, 'field name')),
    ].join(', ');
  }

  async #readOneUnsafe(id, lock = false) {
    const [rows] = await this.database.query(
      `SELECT ${this.#selectColumnsSql()}
       FROM yuncms_users
       WHERE id = ?
       LIMIT 1${lock ? ' FOR UPDATE' : ''}`,
      [id],
    );
    return rows[0] ?? null;
  }

  async readMany(query = {}) {
    await resolveSystemResourceAccess(this, 'read', 'yuncms_users');
    const { sql, params } = buildSystemListQuery(query, {
      table: 'yuncms_users',
      columns: this.#selectColumnList(),
      orderBy: 'email ASC, id ASC',
      searchSchema: USER_SYSTEM_SEARCH_SCHEMA,
    });
    const [rows] = await this.database.query(sql, params);
    return rows;
  }

  async readOne(id) {
    const self = this.accountability.user === id;
    if (!self) await resolveSystemResourceAccess(this, 'read', 'yuncms_users');
    return this.#readOneUnsafe(id);
  }

  async createOne(input = {}) {
    if (this.emitter && !transactionContext(this.database)) {
      return withTransaction(this.database, database => new UsersService({ ...this, database }).createOne(input));
    }
    await resolveSystemResourceAccess(this, 'create', 'yuncms_users');
    const id = randomUUID();
    input = await this.filter('users.create', input, { collection: 'yuncms_users', key: id });
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw invalid('User payload must be an object');
    const email = normalizeEmail(input.email);
    const status = assertStatus(input.status ?? 'active');
    await assertRoleAssignable(this.database, input.role ?? null, this.accountability);

    const customFieldMap = new Map(this.#customFields().map((field) => [field.field, field]));
    const customColumns = [];
    const customParams = [];
    for (const [key, value] of Object.entries(input)) {
      if (!customFieldMap.has(key)) continue;
      const fieldSchema = customFieldMap.get(key);
      if (fieldSchema.readonly) {
        const error = new Error(`Field is read-only: ${key}`);
        error.code = 'FIELD_READ_ONLY';
        error.path = key;
        throw error;
      }
      customColumns.push(quoteIdentifier(fieldSchema.field, 'field name'));
      customParams.push(serializeCustomUserValue(fieldSchema, value));
    }

    const passwordHash = await hashPassword(input.password);
    const verifiedAt = new Date();
    const columnSql = ['id', 'email', 'password_hash', 'role', 'status', 'email_verified_at', ...customColumns].join(', ');
    const placeholdersSql = ['?', '?', '?', '?', '?', '?', ...customColumns.map(() => '?')].join(', ');
    await this.database.query(
      `INSERT INTO yuncms_users (${columnSql})
       VALUES (${placeholdersSql})`,
      [
        id,
        email,
        passwordHash,
        input.role ?? null,
        status,
        verifiedAt,
        ...customParams,
      ],
    );

    const user = await this.#readOneUnsafe(id);
    await this.action('users.create', { key: id, item: user });
    return user;
  }

  async registerPublic(input = {}) {
    if (this.emitter && !transactionContext(this.database)) {
      return withTransaction(this.database, database => new UsersService({ ...this, database }).registerPublic(input));
    }
    if (this.accountability.public !== true) {
      throw forbidden('Public registration is available only to unauthenticated requests');
    }

    const [settingsRows] = await this.database.query(
      `SELECT public_registration_enabled, public_registration_role,
              public_registration_require_email_verification
       FROM yuncms_studio_settings
       WHERE id = 1
       LIMIT 1`,
    );
    const settings = settingsRows[0];
    if (!settings) {
      const error = new Error('Studio settings are missing; run YunCMS bootstrap');
      error.code = 'DATABASE_MIGRATION_REQUIRED';
      throw error;
    }
    if (!settings.public_registration_enabled) {
      throw forbidden('Public registration is disabled');
    }
    if (!settings.public_registration_role) {
      throw forbidden('Public registration has no assigned user role');
    }

    const [roleRows] = await this.database.query(
      'SELECT id, admin, public FROM yuncms_roles WHERE id = ? LIMIT 1',
      [settings.public_registration_role],
    );
    const role = roleRows[0];
    if (!role || role.admin || role.public) {
      throw forbidden('Public registration role is invalid');
    }

    const id = randomUUID();
    input = await this.filter('users.create', input, { collection: 'yuncms_users', key: id, operation: 'register', publicRegistration: true, role: role.id });

    if (!input || typeof input !== 'object' || Array.isArray(input)) {
      throw invalid('Public registration payload must be an object');
    }
    const keys = Object.keys(input);
    if (keys.some((key) => !PUBLIC_REGISTRATION_KEYS.has(key))) {
      throw invalid('Public registration accepts email and password only');
    }

    const email = normalizeEmail(input.email);
    const passwordHash = await hashPassword(input.password);
    const verifiedAt = settings.public_registration_require_email_verification ? null : new Date();
    await this.database.query(
      `INSERT INTO yuncms_users (id, email, password_hash, role, status, email_verified_at)
       VALUES (?, ?, ?, ?, 'active', ?)`,
      [id, email, passwordHash, role.id, verifiedAt],
    );

    const user = await this.#readOneUnsafe(id);
    await this.action('users.create', { key: id, item: user, publicRegistration: true });
    return user;
  }

  async updateOne(id, patch = {}) {
    if (this.emitter && !transactionContext(this.database)) {
      return withTransaction(this.database, database => new UsersService({ ...this, database }).updateOne(id, patch));
    }
    await resolveSystemResourceAccess(this, 'update', 'yuncms_users');
    await assertTargetManageable(this.database, id, this.accountability);
    if (this.emitter) {
      const before = await this.#readOneUnsafe(id, true);
      if (!before) throw Object.assign(new Error(`Unknown user: ${id}`), { code: 'USER_NOT_FOUND' });
      patch = await this.filter('users.update', patch, { collection: 'yuncms_users', key: id, before });
    }
    if (!patch || typeof patch !== 'object' || Array.isArray(patch)) {
      const error = new Error('User patch must be an object');
      error.code = 'INVALID_PAYLOAD';
      throw error;
    }
    const customFieldMap = new Map(this.#customFields().map((field) => [field.field, field]));
    const keys = Object.keys(patch);
    if (keys.length === 0) {
      const error = new Error('User update supports email, role and status only');
      error.code = 'INVALID_PAYLOAD';
      throw error;
    }
    for (const key of keys) {
      if (USER_UPDATE_KEYS.has(key)) continue;
      if (customFieldMap.has(key)) {
        if (customFieldMap.get(key).readonly) {
          const error = new Error(`Field is read-only: ${key}`);
          error.code = 'FIELD_READ_ONLY';
          error.path = key;
          throw error;
        }
        continue;
      }
      const error = new Error('User update supports email, role and status only');
      error.code = 'INVALID_PAYLOAD';
      throw error;
    }

    if (Object.hasOwn(patch, 'status')) {
      assertStatus(patch.status);
      if (this.accountability.user === id && patch.status !== 'active') {
        const error = new Error('A user cannot suspend or disable their own active session');
        error.code = 'SELF_ADMIN_MUTATION_FORBIDDEN';
        throw error;
      }
    }
    if (Object.hasOwn(patch, 'role')) {
      await assertRoleAssignable(this.database, patch.role, this.accountability);
    }

    const selectColumnsSql = this.#selectColumnsSql();
    const user = await withTransaction(this.database, async (connection) => {
      const assignments = [];
      const params = [];

      if (Object.hasOwn(patch, 'email')) {
        assignments.push('email = ?');
        params.push(normalizeEmail(patch.email));
      }
      if (Object.hasOwn(patch, 'role')) {
        assignments.push('role = ?');
        params.push(patch.role ?? null);
      }
      if (Object.hasOwn(patch, 'status')) {
        assignments.push('status = ?');
        params.push(patch.status);
      }
      for (const [key, fieldSchema] of customFieldMap.entries()) {
        if (!Object.hasOwn(patch, key)) continue;
        assignments.push(`${quoteIdentifier(fieldSchema.field, 'field name')} = ?`);
        params.push(serializeCustomUserValue(fieldSchema, patch[key]));
      }

      params.push(id);
      const [result] = await connection.query(
        `UPDATE yuncms_users SET ${assignments.join(', ')} WHERE id = ?`,
        params,
      );
      if (result.affectedRows !== 1) {
        const error = new Error(`Unknown user: ${id}`);
        error.code = 'USER_NOT_FOUND';
        throw error;
      }

      if (Object.hasOwn(patch, 'status') && patch.status !== 'active') {
        await connection.query('DELETE FROM yuncms_sessions WHERE user = ?', [id]);
        await connection.query('DELETE FROM yuncms_mfa_challenges WHERE user = ?', [id]);
      }

      const [rows] = await connection.query(
        `SELECT ${selectColumnsSql}
         FROM yuncms_users WHERE id = ? LIMIT 1`,
        [id],
      );
      return rows[0] ?? null;
    });
    await this.action('users.update', { key: id, item: user, changes: patch });
    return user;
  }

  async deleteOne(id) {
    if (this.emitter && !transactionContext(this.database)) {
      return withTransaction(this.database, database => new UsersService({ ...this, database }).deleteOne(id));
    }
    await resolveSystemResourceAccess(this, 'delete', 'yuncms_users');
    await assertTargetManageable(this.database, id, this.accountability);
    if (this.accountability.user === id) {
      const error = new Error('A user cannot delete their own account from an active session');
      error.code = 'SELF_ADMIN_MUTATION_FORBIDDEN';
      throw error;
    }
    const before = this.emitter ? await this.#readOneUnsafe(id, true) : null;
    await this.filter('users.delete', { key: id }, { collection: 'yuncms_users', key: id, before });
    const [result] = await this.database.query('DELETE FROM yuncms_users WHERE id = ?', [id]);
    if (result.affectedRows !== 1) {
      const error = new Error(`Unknown user: ${id}`);
      error.code = 'USER_NOT_FOUND';
      throw error;
    }
    await this.action('users.delete', { key: id, before });
    return true;
  }

  async updatePassword(id, password) {
    const self = this.accountability.user === id;
    if (!self) assertCredentialManager(this.accountability);
    assertPasswordInput(password);

    return withTransaction(this.database, async (connection) => {
      const service = new UsersService({ ...this, database: connection });
      if (this.emitter) {
        const before = await service.#readOneUnsafe(id, true);
        if (!before) throw Object.assign(new Error(`Unknown user: ${id}`), { code: 'USER_NOT_FOUND' });
        // Admission is veto-only: extensions cannot redirect a credential write
        // or observe/replace the requested password.
        await service.filter('users.password.update', { key: id }, { collection: 'yuncms_users', key: id, before });
      }
      const passwordHash = await hashPassword(password);
      const [result] = await connection.query(
        'UPDATE yuncms_users SET password_hash = ? WHERE id = ?',
        [passwordHash, id],
      );
      if (result.affectedRows !== 1) {
        const error = new Error(`Unknown user: ${id}`);
        error.code = 'USER_NOT_FOUND';
        throw error;
      }
      await connection.query('DELETE FROM yuncms_sessions WHERE user = ?', [id]);
      await connection.query('DELETE FROM yuncms_mfa_challenges WHERE user = ?', [id]);
      await service.action('users.password.update', { key: id });
      return true;
    });
  }
}

export { normalizeEmail };
