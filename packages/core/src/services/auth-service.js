import { verifyPassword } from '../auth/password.js';
import { readAuthenticationUserByEmail } from '../auth/users-repository.js';
import { BaseService } from './base-service.js';
import { SessionsService } from './sessions-service.js';

const DUMMY_PASSWORD_HASH = 'scrypt$N=65536,r=8,p=1,keyLength=64$AAAAAAAAAAAAAAAAAAAAAA$wPIB-ojIevW9SJ6ou99EIix5AukscH1McxhCNVsi1eVkhsxb5QzXquW0YeAFglU5Vh-NthiqKH90soC0JgEJPQ';

function invalidCredentials() {
  const error = new Error('Invalid email or password');
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
    status: user.status,
    email_verified_at: user.email_verified_at ?? null,
  };
}

export class AuthService extends BaseService {
  createSessionsService() {
    return new SessionsService({
      accountability: this.accountability,
      database: this.database,
      schema: this.schema,
      emitter: this.emitter,
      logger: this.logger,
    });
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
      throw invalidCredentials();
    }

    const tokens = await this.createSessionsService().createForUser(user, { ip, userAgent });
    return {
      user: publicUser(user),
      ...tokens,
    };
  }

  async authenticateAccessToken(token) {
    return this.createSessionsService().authenticateAccessToken(token);
  }

  async refresh(refreshToken) {
    const result = await this.createSessionsService().rotateRefreshToken(refreshToken);
    return {
      user: {
        id: result.user,
        email: result.email,
        role: result.role,
      },
      access_token: result.access_token,
      access_expires_at: result.access_expires_at,
      refresh_token: result.refresh_token,
      refresh_expires_at: result.refresh_expires_at,
    };
  }

  async logout(accessToken) {
    return this.createSessionsService().revokeByAccessToken(accessToken);
  }

  async logoutAll() {
    if (!this.accountability.user) {
      const error = new Error('Authenticated user is required');
      error.code = 'UNAUTHORIZED';
      throw error;
    }
    return this.createSessionsService().revokeAllForUser(this.accountability.user);
  }
}
