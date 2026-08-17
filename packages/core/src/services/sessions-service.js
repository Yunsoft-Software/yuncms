import { randomUUID } from 'node:crypto';

import { createOpaqueToken, hashToken, tokenType } from '../auth/tokens.js';
import { BaseService } from './base-service.js';

const ACCESS_TTL_MS = 15 * 60 * 1000;
const REFRESH_TTL_MS = 30 * 24 * 60 * 60 * 1000;

function invalidCredentials() {
  const error = new Error('Invalid or expired authentication token');
  error.code = 'INVALID_CREDENTIALS';
  return error;
}

function addMilliseconds(now, milliseconds) {
  return new Date(now.getTime() + milliseconds);
}

function identityFromRow(row) {
  return {
    user: row.user,
    role: row.role ?? null,
    role_name: row.role_name ?? null,
    admin: Boolean(row.role_admin),
    email: row.email,
    session: row.session_id,
    authMethod: 'session',
  };
}

export class SessionsService extends BaseService {
  async createForUser(user, {
    ip = null,
    userAgent = null,
    now = new Date(),
    accessTtlMs = ACCESS_TTL_MS,
    refreshTtlMs = REFRESH_TTL_MS,
  } = {}) {
    const sessionId = randomUUID();
    const access = createOpaqueToken('access');
    const refresh = createOpaqueToken('refresh', { bytes: 48 });
    const accessExpiresAt = addMilliseconds(now, accessTtlMs);
    const refreshExpiresAt = addMilliseconds(now, refreshTtlMs);

    await this.database.query(
      `INSERT INTO yuncms_sessions
       (id, user, token_hash, access_token_hash, access_expires_at, expires_at, ip, user_agent)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        sessionId,
        user.id,
        refresh.hash,
        access.hash,
        accessExpiresAt,
        refreshExpiresAt,
        ip,
        userAgent,
      ],
    );

    return {
      access_token: access.token,
      access_expires_at: accessExpiresAt,
      refresh_token: refresh.token,
      refresh_expires_at: refreshExpiresAt,
      session: sessionId,
    };
  }

  async authenticateAccessToken(token) {
    if (tokenType(token) !== 'access') throw invalidCredentials();
    const hash = hashToken(token);
    const [rows] = await this.database.query(
      `SELECT s.id AS session_id, s.user, u.email, u.role, u.status,
              r.name AS role_name, r.admin AS role_admin
       FROM yuncms_sessions s
       INNER JOIN yuncms_users u ON u.id = s.user
       LEFT JOIN yuncms_roles r ON r.id = u.role
       WHERE s.access_token_hash = ?
         AND s.access_expires_at > CURRENT_TIMESTAMP(3)
         AND s.expires_at > CURRENT_TIMESTAMP(3)
         AND u.status = 'active'
       LIMIT 1`,
      [hash],
    );
    const row = rows[0];
    if (!row) throw invalidCredentials();

    await this.database.query(
      `UPDATE yuncms_sessions s
       INNER JOIN yuncms_users u ON u.id = s.user
       SET s.last_used_at = CURRENT_TIMESTAMP(3), u.last_access = CURRENT_TIMESTAMP(3)
       WHERE s.id = ?`,
      [row.session_id],
    );

    return identityFromRow(row);
  }

  async rotateRefreshToken(token, {
    now = new Date(),
    accessTtlMs = ACCESS_TTL_MS,
    refreshTtlMs = REFRESH_TTL_MS,
  } = {}) {
    if (tokenType(token) !== 'refresh') throw invalidCredentials();
    const oldHash = hashToken(token);
    const [rows] = await this.database.query(
      `SELECT s.id AS session_id, s.user, u.email, u.role, u.status,
              r.name AS role_name, r.admin AS role_admin
       FROM yuncms_sessions s
       INNER JOIN yuncms_users u ON u.id = s.user
       LEFT JOIN yuncms_roles r ON r.id = u.role
       WHERE s.token_hash = ?
         AND s.expires_at > CURRENT_TIMESTAMP(3)
         AND u.status = 'active'
       LIMIT 1`,
      [oldHash],
    );
    const row = rows[0];
    if (!row) throw invalidCredentials();

    const access = createOpaqueToken('access');
    const refresh = createOpaqueToken('refresh', { bytes: 48 });
    const accessExpiresAt = addMilliseconds(now, accessTtlMs);
    const refreshExpiresAt = addMilliseconds(now, refreshTtlMs);
    const [result] = await this.database.query(
      `UPDATE yuncms_sessions
       SET token_hash = ?, access_token_hash = ?, access_expires_at = ?, expires_at = ?,
           last_used_at = CURRENT_TIMESTAMP(3)
       WHERE id = ? AND token_hash = ?`,
      [
        refresh.hash,
        access.hash,
        accessExpiresAt,
        refreshExpiresAt,
        row.session_id,
        oldHash,
      ],
    );

    if (result.affectedRows !== 1) throw invalidCredentials();

    return {
      ...identityFromRow(row),
      access_token: access.token,
      access_expires_at: accessExpiresAt,
      refresh_token: refresh.token,
      refresh_expires_at: refreshExpiresAt,
    };
  }

  async revokeByAccessToken(token) {
    if (tokenType(token) !== 'access') throw invalidCredentials();
    const [result] = await this.database.query(
      'DELETE FROM yuncms_sessions WHERE access_token_hash = ?',
      [hashToken(token)],
    );
    return result.affectedRows > 0;
  }

  async revokeAllForUser(userId) {
    const self = this.accountability.user === userId;
    if (!self && this.accountability.admin !== true && this.accountability.system !== true) {
      const error = new Error('Session revocation requires self or administrator accountability');
      error.code = 'FORBIDDEN';
      throw error;
    }
    const [result] = await this.database.query(
      'DELETE FROM yuncms_sessions WHERE user = ?',
      [userId],
    );
    return result.affectedRows;
  }
}

export const SESSION_DEFAULTS = Object.freeze({
  accessTtlMs: ACCESS_TTL_MS,
  refreshTtlMs: REFRESH_TTL_MS,
});
