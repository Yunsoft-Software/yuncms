import { randomUUID } from 'node:crypto';

import { createOpaqueToken } from '../auth/tokens.js';
import { BaseService } from './base-service.js';

function forbidden(message) {
  const error = new Error(message);
  error.code = 'FORBIDDEN';
  return error;
}

function targetUser(accountability, requestedUser = null) {
  if (accountability.admin === true || accountability.system === true) {
    const user = requestedUser ?? accountability.user;
    if (!user) {
      const error = new Error('API token user is required');
      error.code = 'INVALID_PAYLOAD';
      throw error;
    }
    return user;
  }

  if (!accountability.user) throw forbidden('Authenticated user is required');
  if (requestedUser && requestedUser !== accountability.user) {
    throw forbidden('API tokens can only be managed for the authenticated user');
  }
  return accountability.user;
}

function parseExpiry(value) {
  if (value == null || value === '') return null;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    const error = new Error('API token expiry is invalid');
    error.code = 'INVALID_PAYLOAD';
    throw error;
  }
  if (date.getTime() <= Date.now()) {
    const error = new Error('API token expiry must be in the future');
    error.code = 'INVALID_PAYLOAD';
    throw error;
  }
  return date;
}

export class ApiTokensService extends BaseService {
  async readMany(userId = null) {
    const user = targetUser(this.accountability, userId);
    const [rows] = await this.database.query(
      `SELECT id, user, name, expires_at, last_used_at, created_at
       FROM yuncms_api_tokens
       WHERE user = ?
       ORDER BY created_at DESC`,
      [user],
    );
    return rows;
  }

  async createOne(input = {}) {
    const user = targetUser(this.accountability, input.user ?? null);
    if (!input.name || typeof input.name !== 'string' || input.name.trim().length === 0) {
      const error = new Error('API token name is required');
      error.code = 'INVALID_PAYLOAD';
      throw error;
    }
    const name = input.name.trim();
    if (name.length > 100) {
      const error = new Error('API token name cannot exceed 100 characters');
      error.code = 'INVALID_PAYLOAD';
      throw error;
    }
    const expiresAt = parseExpiry(input.expires_at ?? input.expiresAt ?? null);

    const [userRows] = await this.database.query(
      `SELECT id FROM yuncms_users WHERE id = ? AND status = 'active' LIMIT 1`,
      [user],
    );
    if (!userRows[0]) {
      const error = new Error(`Unknown or inactive user: ${user}`);
      error.code = 'USER_NOT_FOUND';
      throw error;
    }

    const id = randomUUID();
    const generated = createOpaqueToken('api', { bytes: 40 });
    await this.database.query(
      `INSERT INTO yuncms_api_tokens (id, user, name, token_hash, expires_at)
       VALUES (?, ?, ?, ?, ?)`,
      [id, user, name, generated.hash, expiresAt],
    );

    return {
      id,
      user,
      name,
      token: generated.token,
      expires_at: expiresAt,
    };
  }

  async deleteOne(id, userId = null) {
    const user = targetUser(this.accountability, userId);
    let sql = 'DELETE FROM yuncms_api_tokens WHERE id = ?';
    const params = [id];

    if (this.accountability.admin !== true && this.accountability.system !== true) {
      sql += ' AND user = ?';
      params.push(user);
    } else if (userId) {
      sql += ' AND user = ?';
      params.push(user);
    }

    const [result] = await this.database.query(sql, params);
    return result.affectedRows > 0;
  }
}
