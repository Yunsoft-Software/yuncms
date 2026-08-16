import {
  createAccountability,
  createPublicAccountability,
  createRequestContext,
} from '@yuncms/core';

function bearerToken(header) {
  if (!header) return null;
  const match = /^Bearer\s+([^\s]+)$/i.exec(header);
  if (!match) {
    const error = new Error('Authorization header must use Bearer authentication');
    error.code = 'INVALID_CREDENTIALS';
    throw error;
  }
  return match[1];
}

export function createAuthenticationMiddleware({ pool, config, logger, services }) {
  return async (req, _res, next) => {
    try {
      const AuthService = services.AuthService;
      const bootstrapAccountability = createPublicAccountability();
      const auth = new AuthService({
        accountability: bootstrapAccountability,
        database: pool,
        logger,
      });

      const token = bearerToken(req.get('authorization'));
      let accountability;

      if (token) {
        const identity = await auth.authenticateAccessToken(token);
        accountability = createAccountability({
          user: identity.user,
          role: identity.role,
          admin: identity.admin === true,
        });
        req.authToken = token;
        req.sessionId = identity.session;
      } else {
        accountability = await auth.resolvePublicAccountability();
        req.authToken = null;
        req.sessionId = null;
      }

      req.accountability = accountability;
      req.context = createRequestContext({
        accountability,
        services,
        database: pool,
        logger,
        env: config,
        requestId: req.id,
      });
      next();
    } catch (error) {
      next(error);
    }
  };
}

export { bearerToken };
