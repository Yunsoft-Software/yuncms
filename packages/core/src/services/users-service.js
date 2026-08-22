import { randomUUID } from 'node:crypto';

import { hashPassword } from '../auth/password.js';
import { withTransaction } from '../transaction.js';
import { BaseService } from './base-service.js';
import { resolveSystemResourceAccess } from './system-resource-access.js';

const USER_STATUSES = new Set(['active', 'suspended', 'disabled']);
const USER_UPDATE_KEYS = new Set(['email', 'role', 'status']);

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
  async action(event, payload) {
    if (!this.emitter) return;
    await this.emitter.action(event, payload, {
      accountability: this.accountability,
      requestId: this.requestId,
      collection: 'yuncms_users',
    });
  }

  async #readOneUnsafe(id) {
    const [rows] = await this.database.query(
      `SELECT id, email, role, status, email_verified_at, last_access, created_at, updated_at
       FROM yuncms_users
       WHERE id = ?
       LIMIT 1`,
      [id],
    );
    return rows[0] ?? null;
  }

  async readMany() {
    await resolveSystemResourceAccess(this, 'read', 'yuncms_users');
    const [rows] = await this.database.query(
      `SELECT id, email, role, status, email_verified_at, last_access, created_at, updated_at
       FROM yuncms_users
       ORDER BY email ASC`,
    );
    return rows;
  }

  async readOne(id) {
    const self = this.accountability.user === id;
    if (!self) await resolveSystemResourceAccess(this, 'read', 'yuncms_users');
    return this.#readOneUnsafe(id);
  }

  async createOne(input = {}) {
    await resolveSystemResourceAccess(this, 'create', 'yuncms_users');
    const email = normalizeEmail(input.email);
    const status = assertStatus(input.status ?? 'active');
    await assertRoleAssignable(this.database, input.role ?? null, this.accountability);

    const passwordHash = await hashPassword(input.password);
    const id = randomUUID();
    const verifiedAt = new Date();
    await this.database.query(
      `INSERT INTO yuncms_users (id, email, password_hash, role, status, email_verified_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        id,
        email,
        passwordHash,
        input.role ?? null,
        status,
        verifiedAt,
      ],
    );

    const user = await this.#readOneUnsafe(id);
    await this.action('users.create', { key: id, item: user });
    return user;
  }

  async updateOne(id, patch = {}) {
    await resolveSystemResourceAccess(this, 'update', 'yuncms_users');
    await assertTargetManageable(this.database, id, this.accountability);
    if (!patch || typeof patch !== 'object' || Array.isArray(patch)) {
      const error = new Error('User patch must be an object');
      error.code = 'INVALID_PAYLOAD';
      throw error;
    }
    const keys = Object.keys(patch);
    if (keys.length === 0 || keys.some((key) => !USER_UPDATE_KEYS.has(key))) {
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
      }

      const [rows] = await connection.query(
        `SELECT id, email, role, status, email_verified_at, last_access, created_at, updated_at
         FROM yuncms_users WHERE id = ? LIMIT 1`,
        [id],
      );
      return rows[0] ?? null;
    });
    await this.action('users.update', { key: id, item: user, changes: patch });
    return user;
  }

  async deleteOne(id) {
    await resolveSystemResourceAccess(this, 'delete', 'yuncms_users');
    await assertTargetManageable(this.database, id, this.accountability);
    if (this.accountability.user === id) {
      const error = new Error('A user cannot delete their own account from an active session');
      error.code = 'SELF_ADMIN_MUTATION_FORBIDDEN';
      throw error;
    }
    const before = await this.#readOneUnsafe(id);
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

    const passwordHash = await hashPassword(password);
    const connection = await this.database.getConnection();

    try {
      await connection.beginTransaction();
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
      await connection.commit();
    } catch (error) {
      try {
        await connection.rollback();
      } catch (rollbackError) {
        error.rollbackError = rollbackError;
      }
      throw error;
    } finally {
      connection.release();
    }

    await this.action('users.password.update', { key: id });
    return true;
  }
}

export { normalizeEmail };
