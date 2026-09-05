import { createPublicAccountability } from '../accountability.js';
import { verifyPassword } from '../auth/password.js';
import { hashToken, tokenType } from '../auth/tokens.js';
import { readAuthenticationUserByEmail } from '../auth/users-repository.js';
import { BaseService } from './base-service.js';
import { SessionsService } from './sessions-service.js';

const DUMMY_PASSWORD_HASH = 'scrypt$N=65536,r=8,p=1,keyLength=64$AAAAAAAAAAAAAAAAAAAAAA$wPIB-ojIevW9SJ6ou99EIix5AukscH1McxhCNVsi1eVkhsxb5QzXquW0YeAFglU5Vh-NthiqKH90soC0JgEJPQ';

function invalidLogin() {
  const error = new Error('Invalid email or password');
  error.code = 'INVALID_CREDENTIALS';
  return error;
}

function emailNotVerified() {
  const error = new Error('Email verification is required before sign in');
  error.code = 'EMAIL_NOT_VERIFIED';
  return error;
}

function invalidToken() {
  const error = new Error('Invalid or expired authentication token');
  error.code = 'INVALID_CREDENTIALS';
  return error;
}

function normalizeLoginEmail(email) {
  if (typeof email !== 'string') return null;
  const normalized = email.trim().toLowerCase();
  if (!normalized || normalized.length > 191 || !normalized.includes('@')) return null;
  return normalized;
}

function publicUser(user) {
  return {
    id: user.id,
    email: user.email,
    role: user.role ?? null,
    role_name: user.role_name ?? null,
    admin: Boolean(user.role_admin ?? user.admin),
    status: user.status,
    email_verified_at: user.email_verified_at ?? null,
  };
}

export class AuthService extends BaseService {
  async action(event, payload, context = {}) {
    if (!this.emitter) return;
    await this.emitter.action(event, payload, {
      accountability: this.accountability,
      requestId: this.requestId,
      collection: 'yuncms_users',
      ...context,
    });
  }

  createSessionsService() {
    return new SessionsService({
      accountability: this.accountability,
      database: this.database,
      schema: this.schema,
      emitter: this.emitter,
      logger: this.logger,
    });
  }

  async resolvePublicAccountability() {
    const [rows] = await this.database.query(
      `SELECT id
       FROM yuncms_roles
       WHERE public = 1
       ORDER BY created_at ASC
       LIMIT 2`,
    );

    if (rows.length > 1) {
      const error = new Error('Multiple public roles are configured');
      error.code = 'PUBLIC_ROLE_AMBIGUOUS';
      throw error;
    }

    return createPublicAccountability({ role: rows[0]?.id ?? null });
  }

  async login({ email, password, ip = null, userAgent = null } = {}) {
    const normalizedEmail = normalizeLoginEmail(email);
    const user = normalizedEmail
      ? await readAuthenticationUserByEmail(this.database, normalizedEmail)
      : null;

    const passwordMatches = await verifyPassword(
      typeof password === 'string' ? password : '',
      user?.password_hash ?? DUMMY_PASSWORD_HASH,
    );

    if (!user || !passwordMatches || user.status !== 'active') {
      await this.action('auth.login.failed', {
        method: 'local',
        reason: 'invalid_credentials',
      }, { ip });
      throw invalidLogin();
    }

    if (!user.email_verified_at) {
      const [settingsRows] = await this.database.query(
        `SELECT public_registration_require_email_verification
         FROM yuncms_studio_settings
         WHERE id = 1
         LIMIT 1`,
      );
      if (settingsRows[0]?.public_registration_require_email_verification) {
        await this.action('auth.login.failed', {
          method: 'local',
          reason: 'email_not_verified',
          user: user.id,
        }, { ip });
        throw emailNotVerified();
      }
    }

    const tokens = await this.createSessionsService().createForUser(user, { ip, userAgent });
    await this.action('auth.login.success', {
      method: 'local',
      user: user.id,
      role: user.role ?? null,
    }, { ip });
    return {
      user: publicUser(user),
      ...tokens,
    };
  }

  async authenticateAccessToken(token) {
    return this.createSessionsService().authenticateAccessToken(token);
  }

  async authenticateApiToken(token) {
    if (tokenType(token) !== 'api') throw invalidToken();
    const [rows] = await this.database.query(
      `SELECT t.id AS api_token_id, t.user, u.email, u.role, u.status,
              r.name AS role_name, r.admin AS role_admin
       FROM yuncms_api_tokens t
       INNER JOIN yuncms_users u ON u.id = t.user
       LEFT JOIN yuncms_roles r ON r.id = u.role
       WHERE t.token_hash = ?
         AND (t.expires_at IS NULL OR t.expires_at > CURRENT_TIMESTAMP(3))
         AND u.status = 'active'
       LIMIT 1`,
      [hashToken(token)],
    );
    const row = rows[0];
    if (!row) throw invalidToken();

    await this.database.query(
      `UPDATE yuncms_api_tokens t
       INNER JOIN yuncms_users u ON u.id = t.user
       SET t.last_used_at = CURRENT_TIMESTAMP(3), u.last_access = CURRENT_TIMESTAMP(3)
       WHERE t.id = ?`,
      [row.api_token_id],
    );

    return {
      user: row.user,
      role: row.role ?? null,
      role_name: row.role_name ?? null,
      admin: Boolean(row.role_admin),
      email: row.email,
      session: null,
      apiToken: row.api_token_id,
      authMethod: 'api_token',
    };
  }

  async authenticateBearerToken(token) {
    const type = tokenType(token);
    if (type === 'access') return this.authenticateAccessToken(token);
    if (type === 'api') return this.authenticateApiToken(token);
    throw invalidToken();
  }

  async refresh(refreshToken) {
    const result = await this.createSessionsService().rotateRefreshToken(refreshToken);
    await this.action('auth.refresh.success', {
      method: 'session',
      user: result.user,
      role: result.role ?? null,
    });
    return {
      user: {
        id: result.user,
        email: result.email,
        role: result.role,
        role_name: result.role_name ?? null,
        admin: result.admin === true,
      },
      access_token: result.access_token,
      access_expires_at: result.access_expires_at,
      refresh_token: result.refresh_token,
      refresh_expires_at: result.refresh_expires_at,
    };
  }

  async logout(accessToken) {
    const revoked = await this.createSessionsService().revokeByAccessToken(accessToken);
    await this.action('auth.logout', {
      method: 'session',
      user: this.accountability.user ?? null,
      all: false,
      revoked: Boolean(revoked),
    });
    return revoked;
  }

  async logoutAll() {
    if (!this.accountability.user) {
      const error = new Error('Authenticated user is required');
      error.code = 'UNAUTHORIZED';
      throw error;
    }
    const revoked = await this.createSessionsService().revokeAllForUser(this.accountability.user);
    await this.action('auth.logout', {
      method: 'session',
      user: this.accountability.user,
      all: true,
      revoked: Number(revoked ?? 0),
    });
    return revoked;
  }
}
