import { randomUUID } from 'node:crypto';

import { hashPassword } from '../auth/password.js';
import { createOpaqueToken, hashToken, tokenType } from '../auth/tokens.js';
import { readAuthenticationUserByEmail } from '../auth/users-repository.js';
import { BaseService } from './base-service.js';
import { normalizeEmail } from './users-service.js';

const TOKEN_TYPES = Object.freeze({
  reset: 'password_reset',
  verify: 'email_verification',
});

const DEFAULT_TTL_MS = Object.freeze({
  reset: 60 * 60 * 1000,
  verify: 24 * 60 * 60 * 1000,
});

function invalidActionToken() {
  const error = new Error('Invalid or expired action token');
  error.code = 'INVALID_TOKEN';
  return error;
}

function assertPositiveTtl(ttlMs) {
  if (!Number.isInteger(ttlMs) || ttlMs < 60_000 || ttlMs > 7 * 24 * 60 * 60 * 1000) {
    const error = new Error('Token TTL must be between 1 minute and 7 days');
    error.code = 'INVALID_PAYLOAD';
    throw error;
  }
}

function assertVerificationManager(accountability) {
  if (accountability.system === true || accountability.admin === true) return;
  const error = new Error('Email verification lookup requires administrator accountability');
  error.code = 'FORBIDDEN';
  throw error;
}

export class AuthTokensService extends BaseService {
  async createForUser(userId, type, { ttlMs = DEFAULT_TTL_MS[type] } = {}) {
    if (!TOKEN_TYPES[type]) {
      const error = new Error(`Unsupported auth token type: ${type}`);
      error.code = 'INVALID_PAYLOAD';
      throw error;
    }
    assertPositiveTtl(ttlMs);

    const [users] = await this.database.query(
      'SELECT id, status FROM yuncms_users WHERE id = ? LIMIT 1',
      [userId],
    );
    if (!users[0] || users[0].status !== 'active') {
      const error = new Error(`Active user not found: ${userId}`);
      error.code = 'USER_NOT_FOUND';
      throw error;
    }

    const generated = createOpaqueToken(type);
    const expiresAt = new Date(Date.now() + ttlMs);
    const connection = await this.database.getConnection();

    try {
      await connection.beginTransaction();
      await connection.query(
        `DELETE FROM yuncms_auth_tokens
         WHERE user = ? AND type = ? AND used_at IS NULL`,
        [userId, TOKEN_TYPES[type]],
      );
      await connection.query(
        `INSERT INTO yuncms_auth_tokens (id, user, type, token_hash, expires_at)
         VALUES (?, ?, ?, ?, ?)`,
        [randomUUID(), userId, TOKEN_TYPES[type], generated.hash, expiresAt],
      );
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

    return {
      token: generated.token,
      expires_at: expiresAt,
    };
  }

  async requestPasswordReset(email, options = {}) {
    let normalized;
    try {
      normalized = normalizeEmail(email);
    } catch {
      return null;
    }

    const user = await readAuthenticationUserByEmail(this.database, normalized);
    if (!user || user.status !== 'active') return null;
    return this.createForUser(user.id, 'reset', options);
  }

  async resetPassword(token, password) {
    if (tokenType(token) !== 'reset') throw invalidActionToken();
    const passwordHash = await hashPassword(password);
    const connection = await this.database.getConnection();

    try {
      await connection.beginTransaction();
      const [rows] = await connection.query(
        `SELECT id, user
         FROM yuncms_auth_tokens
         WHERE token_hash = ?
           AND type = ?
           AND used_at IS NULL
           AND expires_at > CURRENT_TIMESTAMP(3)
         LIMIT 1
         FOR UPDATE`,
        [hashToken(token), TOKEN_TYPES.reset],
      );
      const actionToken = rows[0];
      if (!actionToken) throw invalidActionToken();

      const [result] = await connection.query(
        `UPDATE yuncms_users
         SET password_hash = ?
         WHERE id = ? AND status = 'active'`,
        [passwordHash, actionToken.user],
      );
      if (result.affectedRows !== 1) throw invalidActionToken();

      await connection.query(
        'UPDATE yuncms_auth_tokens SET used_at = CURRENT_TIMESTAMP(3) WHERE id = ?',
        [actionToken.id],
      );
      await connection.query('DELETE FROM yuncms_sessions WHERE user = ?', [actionToken.user]);
      await connection.query(
        `DELETE FROM yuncms_auth_tokens
         WHERE user = ? AND type = ? AND id <> ?`,
        [actionToken.user, TOKEN_TYPES.reset, actionToken.id],
      );
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

  async createEmailVerification(userId, options = {}) {
    const canIssue =
      this.accountability.system === true ||
      this.accountability.admin === true ||
      this.accountability.user === userId;
    if (!canIssue) {
      const error = new Error('Email verification token can only be issued for the authenticated user');
      error.code = 'FORBIDDEN';
      throw error;
    }
    return this.createForUser(userId, 'verify', options);
  }

  async requestEmailVerification(email, options = {}) {
    assertVerificationManager(this.accountability);

    let normalized;
    try {
      normalized = normalizeEmail(email);
    } catch {
      return null;
    }

    const user = await readAuthenticationUserByEmail(this.database, normalized);
    if (!user || user.status !== 'active' || user.email_verified_at) return null;
    const result = await this.createForUser(user.id, 'verify', options);
    return {
      ...result,
      user: {
        id: user.id,
        email: user.email,
      },
    };
  }

  async verifyEmail(token) {
    if (tokenType(token) !== 'verify') throw invalidActionToken();
    const connection = await this.database.getConnection();

    try {
      await connection.beginTransaction();
      const [rows] = await connection.query(
        `SELECT id, user
         FROM yuncms_auth_tokens
         WHERE token_hash = ?
           AND type = ?
           AND used_at IS NULL
           AND expires_at > CURRENT_TIMESTAMP(3)
         LIMIT 1
         FOR UPDATE`,
        [hashToken(token), TOKEN_TYPES.verify],
      );
      const actionToken = rows[0];
      if (!actionToken) throw invalidActionToken();

      const [result] = await connection.query(
        `UPDATE yuncms_users
         SET email_verified_at = COALESCE(email_verified_at, CURRENT_TIMESTAMP(3))
         WHERE id = ? AND status = 'active'`,
        [actionToken.user],
      );
      if (result.affectedRows !== 1) throw invalidActionToken();

      await connection.query(
        'UPDATE yuncms_auth_tokens SET used_at = CURRENT_TIMESTAMP(3) WHERE id = ?',
        [actionToken.id],
      );
      await connection.query(
        `DELETE FROM yuncms_auth_tokens
         WHERE user = ? AND type = ? AND id <> ?`,
        [actionToken.user, TOKEN_TYPES.verify, actionToken.id],
      );
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
