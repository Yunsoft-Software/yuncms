import { randomUUID } from 'node:crypto';

import {
  assertLocalRedirectTarget,
  decryptExternalAuthSecret,
  encryptExternalAuthSecret,
  hashExternalAuthState,
} from '../auth/external-state.js';
import { withTransaction } from '../transaction.js';
import { BaseService } from './base-service.js';
import { SessionsService } from './sessions-service.js';

const AUTH_TRANSACTION_TTL_MS = 5 * 60 * 1000;

function externalAuthError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function normalizeProvider(value) {
  const provider = String(value ?? '').trim();
  if (!/^[a-z0-9][a-z0-9._-]{0,63}$/i.test(provider)) {
    throw externalAuthError('INVALID_AUTH_PROVIDER', 'External auth provider id is invalid');
  }
  return provider;
}

function normalizeSubject(value) {
  const subject = String(value ?? '').trim();
  if (!subject || subject.length > 255 || /[\r\n\0]/.test(subject)) {
    throw externalAuthError('INVALID_EXTERNAL_IDENTITY', 'External identity subject is invalid');
  }
  return subject;
}

function normalizeEmail(value) {
  if (value == null || value === '') return null;
  const email = String(value).trim().toLowerCase();
  if (!email || email.length > 191 || !email.includes('@') || /[\r\n\0]/.test(email)) return null;
  return email;
}

function safeProfile(profile) {
  if (!profile || typeof profile !== 'object' || Array.isArray(profile)) return null;
  const safe = {};
  for (const key of ['name', 'given_name', 'family_name', 'preferred_username', 'picture', 'groups']) {
    if (!Object.hasOwn(profile, key)) continue;
    const value = profile[key];
    if (typeof value === 'string' && value.length <= 1024) safe[key] = value;
    else if (Array.isArray(value) && value.length <= 100) safe[key] = value.filter((entry) => typeof entry === 'string').slice(0, 100);
  }
  return Object.keys(safe).length ? safe : null;
}

function publicUser(user) {
  return {
    id: user.id,
    email: user.email,
    role: user.role ?? null,
    role_name: user.role_name ?? null,
    status: user.status,
    email_verified_at: user.email_verified_at ?? null,
  };
}

function isDuplicateEntry(error) {
  return error?.code === 'ER_DUP_ENTRY' || error?.errno === 1062;
}

export class ExternalAuthService extends BaseService {
  constructor(options = {}) {
    super(options);
    this.stateSecret = options.stateSecret;
  }

  async action(event, payload, context = {}) {
    if (!this.emitter) return;
    await this.emitter.action(event, payload, {
      accountability: this.accountability,
      requestId: this.requestId,
      ...context,
    });
  }

  async beginTransaction({ provider, state, secret = null, redirectTarget = '/', metadata = null, ttlMs = AUTH_TRANSACTION_TTL_MS } = {}) {
    const providerId = normalizeProvider(provider);
    const stateHash = hashExternalAuthState(state);
    const redirect = assertLocalRedirectTarget(redirectTarget);
    if (!Number.isInteger(ttlMs) || ttlMs < 30_000 || ttlMs > 15 * 60_000) {
      throw externalAuthError('INVALID_AUTH_TRANSACTION', 'External auth transaction TTL must be between 30 seconds and 15 minutes');
    }
    const expiresAt = new Date(Date.now() + ttlMs);
    const id = randomUUID();
    const encrypted = secret == null ? null : encryptExternalAuthSecret(this.stateSecret, secret);
    const safeMetadata = metadata && typeof metadata === 'object' && !Array.isArray(metadata) ? metadata : null;

    await this.database.query(
      `INSERT INTO yuncms_auth_transactions
       (id, provider, state_hash, secret_ciphertext, redirect_target, metadata, expires_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [id, providerId, stateHash, encrypted, redirect, safeMetadata == null ? null : JSON.stringify(safeMetadata), expiresAt],
    );
    return { id, provider: providerId, redirectTarget: redirect, expiresAt };
  }

  async consumeTransaction({ provider, state } = {}) {
    const providerId = normalizeProvider(provider);
    const stateHash = hashExternalAuthState(state);

    return withTransaction(this.database, async (connection) => {
      const [rows] = await connection.query(
        `SELECT id, provider, secret_ciphertext, redirect_target, metadata, expires_at, used_at
         FROM yuncms_auth_transactions
         WHERE provider = ? AND state_hash = ?
         LIMIT 1 FOR UPDATE`,
        [providerId, stateHash],
      );
      const transaction = rows[0];
      if (!transaction || transaction.used_at || new Date(transaction.expires_at).getTime() <= Date.now()) {
        throw externalAuthError('INVALID_AUTH_TRANSACTION', 'External authentication transaction is invalid or expired');
      }
      const [result] = await connection.query(
        `UPDATE yuncms_auth_transactions
         SET used_at = CURRENT_TIMESTAMP(3)
         WHERE id = ? AND used_at IS NULL`,
        [transaction.id],
      );
      if (result.affectedRows !== 1) throw externalAuthError('INVALID_AUTH_TRANSACTION', 'External authentication transaction was already consumed');

      let metadata = transaction.metadata;
      if (typeof metadata === 'string') {
        try { metadata = JSON.parse(metadata); } catch { metadata = null; }
      }
      return {
        id: transaction.id,
        provider: transaction.provider,
        redirectTarget: assertLocalRedirectTarget(transaction.redirect_target),
        metadata: metadata && typeof metadata === 'object' ? metadata : null,
        secret: transaction.secret_ciphertext == null ? null : decryptExternalAuthSecret(this.stateSecret, transaction.secret_ciphertext),
      };
    });
  }

  async cleanupTransactions({ batchSize = 1000 } = {}) {
    if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > 5000) throw new Error('Invalid auth transaction cleanup batch size');
    const [rows] = await this.database.query(
      `SELECT id FROM yuncms_auth_transactions
       WHERE expires_at < CURRENT_TIMESTAMP(3) OR used_at IS NOT NULL
       ORDER BY created_at ASC
       LIMIT ?`,
      [batchSize],
    );
    if (rows.length === 0) return 0;
    const placeholders = rows.map(() => '?').join(', ');
    const [result] = await this.database.query(
      `DELETE FROM yuncms_auth_transactions WHERE id IN (${placeholders})`,
      rows.map((row) => row.id),
    );
    return result.affectedRows;
  }

  async readIdentity(provider, subject, database = this.database) {
    const [rows] = await database.query(
      `SELECT i.id AS identity_id, i.provider, i.subject, i.user, i.email AS identity_email,
              u.id, u.email, u.role, u.status, u.email_verified_at,
              r.name AS role_name, r.admin AS role_admin, r.public AS role_public
       FROM yuncms_auth_identities i
       INNER JOIN yuncms_users u ON u.id = i.user
       LEFT JOIN yuncms_roles r ON r.id = u.role
       WHERE i.provider = ? AND i.subject = ?
       LIMIT 1`,
      [normalizeProvider(provider), normalizeSubject(subject)],
    );
    return rows[0] ?? null;
  }

  async resolveJitRole(roleId, database) {
    if (!roleId) throw externalAuthError('EXTERNAL_JIT_ROLE_REQUIRED', 'JIT external authentication requires a default role');
    const [rows] = await database.query(
      'SELECT id, name, admin, public FROM yuncms_roles WHERE id = ? LIMIT 1',
      [String(roleId)],
    );
    const role = rows[0];
    if (!role || role.admin || role.public) {
      throw externalAuthError('INVALID_EXTERNAL_JIT_ROLE', 'External JIT role must be an existing non-admin, non-public role');
    }
    return role;
  }

  async #createOrLinkIdentity({ providerId, subjectId, normalizedEmail, emailVerified, sanitizedProfile, policy }) {
    if (!normalizedEmail || emailVerified !== true) {
      throw externalAuthError('VERIFIED_EXTERNAL_EMAIL_REQUIRED', 'A verified external email is required to create or link a YunCMS user');
    }

    try {
      return await withTransaction(this.database, async (connection) => {
        const existingIdentity = await this.readIdentity(providerId, subjectId, connection);
        if (existingIdentity) return existingIdentity.user;

        const [emailRows] = await connection.query(
          `SELECT u.id, u.email, u.role, u.status, u.email_verified_at,
                  r.name AS role_name, r.admin AS role_admin, r.public AS role_public
           FROM yuncms_users u
           LEFT JOIN yuncms_roles r ON r.id = u.role
           WHERE u.email = ? LIMIT 1 FOR UPDATE`,
          [normalizedEmail],
        );
        const existingUser = emailRows[0] ?? null;
        let localUserId;

        if (existingUser) {
          if (policy.linkByVerifiedEmail !== true) {
            throw externalAuthError('EXTERNAL_EMAIL_CONFLICT', 'A YunCMS user already exists for this email and automatic linking is disabled');
          }
          if (existingUser.status !== 'active') throw externalAuthError('EXTERNAL_USER_INACTIVE', 'Linked YunCMS user is not active');
          if (existingUser.role_admin && policy.allowAdminLink !== true) {
            throw externalAuthError('EXTERNAL_ADMIN_LINK_FORBIDDEN', 'Automatic external identity linking to administrator users is disabled');
          }
          localUserId = existingUser.id;
        } else {
          if (policy.jit !== true) throw externalAuthError('EXTERNAL_IDENTITY_NOT_LINKED', 'External identity is not linked to a YunCMS user');
          const role = await this.resolveJitRole(policy.defaultRole, connection);
          localUserId = randomUUID();
          await connection.query(
            `INSERT INTO yuncms_users
             (id, email, password_hash, role, status, email_verified_at)
             VALUES (?, ?, NULL, ?, 'active', CURRENT_TIMESTAMP(3))`,
            [localUserId, normalizedEmail, role.id],
          );
        }

        await connection.query(
          `INSERT INTO yuncms_auth_identities
           (id, provider, subject, user, email, profile, last_login_at)
           VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP(3))`,
          [randomUUID(), providerId, subjectId, localUserId, normalizedEmail, sanitizedProfile == null ? null : JSON.stringify(sanitizedProfile)],
        );
        return localUserId;
      });
    } catch (error) {
      if (!isDuplicateEntry(error)) throw error;
      const identity = await this.readIdentity(providerId, subjectId);
      if (!identity) throw error;
      return identity.user;
    }
  }

  async completeLogin({
    provider,
    subject,
    email = null,
    emailVerified = false,
    profile = null,
    policy = {},
    ip = null,
    userAgent = null,
  } = {}) {
    const providerId = normalizeProvider(provider);
    const subjectId = normalizeSubject(subject);
    const normalizedEmail = normalizeEmail(email);
    const sanitizedProfile = safeProfile(profile);
    let user = await this.readIdentity(providerId, subjectId);

    if (!user) {
      if (policy.jit !== true && policy.linkByVerifiedEmail !== true) {
        throw externalAuthError('EXTERNAL_IDENTITY_NOT_LINKED', 'External identity is not linked to a YunCMS user');
      }
      const userId = await this.#createOrLinkIdentity({
        providerId,
        subjectId,
        normalizedEmail,
        emailVerified,
        sanitizedProfile,
        policy,
      });
      const [userRows] = await this.database.query(
        `SELECT u.id, u.email, u.role, u.status, u.email_verified_at,
                r.name AS role_name, r.admin AS role_admin, r.public AS role_public
         FROM yuncms_users u
         LEFT JOIN yuncms_roles r ON r.id = u.role
         WHERE u.id = ? LIMIT 1`,
        [userId],
      );
      user = userRows[0] ?? null;
    } else {
      await this.database.query(
        `UPDATE yuncms_auth_identities
         SET email = COALESCE(?, email), profile = COALESCE(?, profile), last_login_at = CURRENT_TIMESTAMP(3)
         WHERE id = ?`,
        [normalizedEmail, sanitizedProfile == null ? null : JSON.stringify(sanitizedProfile), user.identity_id],
      );
    }

    if (!user || user.status !== 'active') throw externalAuthError('EXTERNAL_USER_INACTIVE', 'Linked YunCMS user is not active');
    const sessions = new SessionsService({
      accountability: this.accountability,
      database: this.database,
      schema: this.schema,
      emitter: this.emitter,
      logger: this.logger,
      requestId: this.requestId,
    });
    const tokens = await sessions.createForUser(user, { ip, userAgent });
    await this.action('auth.login.success', {
      method: 'external',
      provider: providerId,
      user: user.id,
      role: user.role ?? null,
    });
    return { user: publicUser(user), ...tokens };
  }

  async loginFailed(provider, reason = 'external_auth_failed') {
    await this.action('auth.login.failed', {
      method: 'external',
      provider: normalizeProvider(provider),
      reason: String(reason).slice(0, 100),
    });
  }
}

export { AUTH_TRANSACTION_TTL_MS };
