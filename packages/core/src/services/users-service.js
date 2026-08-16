import { randomUUID } from 'node:crypto';

import { hashPassword } from '../auth/password.js';
import { withTransaction } from '../transaction.js';
import { BaseService } from './base-service.js';

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

function assertUserManager(accountability) {
  if (accountability.admin === true || accountability.system === true) return;
  const error = new Error('User management requires administrator accountability');
  error.code = 'FORBIDDEN';
  throw error;
}

function assertStatus(status) {
  if (!USER_STATUSES.has(status)) {
    const error = new Error(`Unsupported user status: ${status}`);
    error.code = 'INVALID_PAYLOAD';
    throw error;
  }
  return status;
}

async function assertRoleExists(database, role) {
  if (role == null) return;
  const [roleRows] = await database.query('SELECT id FROM yuncms_roles WHERE id = ? LIMIT 1', [role]);
  if (!roleRows[0]) {
    const error = new Error(`Unknown role: ${role}`);
    error.code = 'ROLE_NOT_FOUND';
    throw error;
  }
}

export class UsersService extends BaseService {
  async readMany() {
    assertUserManager(this.accountability);
    const [rows] = await this.database.query(
      `SELECT id, email, role, status, email_verified_at, last_access, created_at, updated_at
       FROM yuncms_users
       ORDER BY email ASC`,
    );
    return rows;
  }

  async readOne(id) {
    const self = this.accountability.user === id;
    if (!self) assertUserManager(this.accountability);

    const [rows] = await this.database.query(
      `SELECT id, email, role, status, email_verified_at, last_access, created_at, updated_at
       FROM yuncms_users
       WHERE id = ?
       LIMIT 1`,
      [id],
    );
    return rows[0] ?? null;
  }

  async createOne(input = {}) {
    assertUserManager(this.accountability);
    const email = normalizeEmail(input.email);
    const status = assertStatus(input.status ?? 'active');
    await assertRoleExists(this.database, input.role ?? null);

    const passwordHash = await hashPassword(input.password);
    const id = randomUUID();
    await this.database.query(
      `INSERT INTO yuncms_users (id, email, password_hash, role, status, email_verified_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        id,
        email,
        passwordHash,
        input.role ?? null,
        status,
        input.emailVerified === true ? new Date() : null,
      ],
    );

    return this.readOne(id);
  }

  async updateOne(id, patch = {}) {
    assertUserManager(this.accountability);
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
        const error = new Error('An administrator cannot suspend or disable their own active session');
        error.code = 'SELF_ADMIN_MUTATION_FORBIDDEN';
        throw error;
      }
    }
    if (Object.hasOwn(patch, 'role')) await assertRoleExists(this.database, patch.role);

    return withTransaction(this.database, async (connection) => {
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
  }

  async deleteOne(id) {
    assertUserManager(this.accountability);
    if (this.accountability.user === id) {
      const error = new Error('An administrator cannot delete their own user account');
      error.code = 'SELF_ADMIN_MUTATION_FORBIDDEN';
      throw error;
    }
    const [result] = await this.database.query('DELETE FROM yuncms_users WHERE id = ?', [id]);
    if (result.affectedRows !== 1) {
      const error = new Error(`Unknown user: ${id}`);
      error.code = 'USER_NOT_FOUND';
      throw error;
    }
    return true;
  }

  async updatePassword(id, password) {
    const self = this.accountability.user === id;
    if (!self) assertUserManager(this.accountability);

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
      return true;
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
  }
}

export { normalizeEmail };
