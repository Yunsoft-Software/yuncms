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

function isPublicAuthRoute(req) {
  return req.method === 'POST' && (req.path === '/auth/login' || req.path === '/auth/refresh');
}

export function createAuthenticationMiddleware({
  pool,
  config,
  logger,
  services,
  schemaCache = null,
  emitter = null,
}) {
  return async (req, _res, next) => {
    try {
      const AuthService = services.AuthService;
      const bootstrapAccountability = createPublicAccountability();
      const auth = new AuthService({
        accountability: bootstrapAccountability,
        database: pool,
        logger,
        emitter,
      });

      const token = bearerToken(req.get('authorization'));
      let accountability;

      if (token) {
        const identity = await auth.authenticateBearerToken(token);
        accountability = createAccountability({
          user: identity.user,
          role: identity.role,
          admin: identity.admin === true,
        });
        req.authToken = token;
        req.authMethod = identity.authMethod;
        req.sessionId = identity.session ?? null;
        req.apiTokenId = identity.apiToken ?? null;
      } else if (isPublicAuthRoute(req)) {
        accountability = bootstrapAccountability;
        req.authToken = null;
        req.authMethod = 'public';
        req.sessionId = null;
        req.apiTokenId = null;
      } else {
        accountability = await auth.resolvePublicAccountability();
        req.authToken = null;
        req.authMethod = 'public';
        req.sessionId = null;
        req.apiTokenId = null;
      }

      const schema = schemaCache ? await schemaCache.get(pool) : null;
      req.accountability = accountability;
      req.context = createRequestContext({
        accountability,
        services,
        database: pool,
        schema,
        logger,
        env: config,
        emitter,
        requestId: req.id,
      });
      next();
    } catch (error) {
      next(error);
    }
  };
}

export { bearerToken, isPublicAuthRoute };
