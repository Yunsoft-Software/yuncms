import { randomUUID } from 'node:crypto';

import { hashPassword } from '../auth/password.js';
import { BaseService } from './base-service.js';

const USER_STATUSES = new Set(['active', 'suspended', 'disabled']);

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
    const status = input.status ?? 'active';
    if (!USER_STATUSES.has(status)) {
      const error = new Error(`Unsupported user status: ${status}`);
      error.code = 'INVALID_PAYLOAD';
      throw error;
    }

    if (input.role != null) {
      const [roleRows] = await this.database.query('SELECT id FROM yuncms_roles WHERE id = ? LIMIT 1', [input.role]);
      if (!roleRows[0]) {
        const error = new Error(`Unknown role: ${input.role}`);
        error.code = 'ROLE_NOT_FOUND';
        throw error;
      }
    }

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
