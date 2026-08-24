import { randomUUID } from 'node:crypto';
import express from 'express';
import {
  createCoreServiceRegistry,
  pingDatabase,
} from '@yunsoft/yuncms-core';

import { createAuthenticationMiddleware } from './authentication.js';
import { apiErrorHandler } from './error-response.js';
import { createPressureLimit } from './pressure-limit.js';
import { createFixedWindowRateLimit } from './rate-limit.js';
import { createAuditRouter } from './routes/audit.js';
import { createAuthRouter } from './routes/auth.js';
import { createFilesRouter } from './routes/files.js';
import { createItemsRouter } from './routes/items.js';
import { createPermissionsRouter } from './routes/permissions.js';
import { createRolesRouter } from './routes/roles.js';
import { createSchemaRouter } from './routes/schema.js';
import { createStudioNavigationRouter } from './routes/studio-navigation.js';
import { createStudioSettingsRouter } from './routes/studio-settings.js';
import { createSystemSchemaRouter } from './routes/system-schema.js';
import { createUsersRouter } from './routes/users.js';
import { createStudioMiddleware } from './studio.js';

const REQUEST_ID_PATTERN = /^[A-Za-z0-9._:-]{1,64}$/;
const CONTENT_SECURITY_POLICY = [
  "default-src 'self'", "base-uri 'self'", "object-src 'none'", "frame-ancestors 'none'",
  "script-src 'self'", "style-src 'self' 'unsafe-inline'", "img-src 'self' data: blob: https://yunsoft.com",
  "font-src 'self' data:", "connect-src 'self'", "media-src 'self' blob:", "frame-src 'self' blob:",
  "worker-src 'self' blob:", "form-action 'self'",
].join('; ');

function securityHeaders(req, res, next) {
  res.set('x-content-type-options', 'nosniff');
  res.set('x-frame-options', 'DENY');
  res.set('referrer-policy', 'no-referrer');
  res.set('permissions-policy', 'camera=(), microphone=(), geolocation=(), payment=(), usb=()');
  res.set('cross-origin-resource-policy', 'same-origin');
  res.set('cross-origin-opener-policy', 'same-origin');
  res.set('x-dns-prefetch-control', 'off');
  res.set('content-security-policy', CONTENT_SECURITY_POLICY);
  if (req.secure === true) res.set('strict-transport-security', 'max-age=15552000; includeSubDomains');
  next();
}

function studioCors(config) {
  return (req, res, next) => {
    const origin = req.get('origin');
    const allowedOrigin = config?.server?.studioOrigin;
    if (origin && allowedOrigin && origin === allowedOrigin) {
      res.set('access-control-allow-origin', origin);
      res.set('vary', 'Origin');
      res.set('access-control-allow-headers', 'content-type, authorization, x-request-id, x-filename, x-title, x-mimetype, mcp-protocol-version, mcp-method, mcp-name');
      res.set('access-control-allow-methods', 'GET,POST,PATCH,DELETE,OPTIONS');
    }
    if (req.method === 'OPTIONS') return res.sendStatus(204);
    return next();
  };
}

function requestIdentity(req, res, next) {
  const supplied = req.get('x-request-id');
  req.id = supplied && REQUEST_ID_PATTERN.test(supplied) ? supplied : randomUUID();
  res.set('x-request-id', req.id);
  next();
}

function createApiRateLimit(config, rateLimitStore = null, logger = console) {
  const limits = config?.server?.rateLimit;
  if (!limits?.enabled) return null;
  return createFixedWindowRateLimit({
    windowMs: limits.windowMs,
    max: limits.max,
    maxBuckets: limits.maxBuckets,
    store: limits.store === 'redis' ? rateLimitStore : null,
    scope: 'api',
    failureMode: limits.failureMode ?? 'best-effort',
    logger,
  });
}

function requestEventMetadata(req, res, startedAt) {
  return {
    requestId: req.id ?? null,
    method: req.method,
    route: req.route?.path ?? req.path,
    status: res.statusCode,
    durationMs: Math.max(0, Date.now() - startedAt),
    accountability: req.accountability ? {
      user: req.accountability.user ?? null,
      role: req.accountability.role ?? null,
      admin: req.accountability.admin === true,
      system: req.accountability.system === true,
    } : null,
    ip: req.ip ?? null,
  };
}

function createRequestEvents(emitter) {
  if (!emitter) return null;
  return (req, res, next) => {
    const startedAt = Date.now();
    emitter.action('request.received', requestEventMetadata(req, res, startedAt), {
      accountability: req.accountability,
      requestId: req.id,
    }).catch(() => {});
    res.once('finish', () => {
      emitter.action('request.completed', requestEventMetadata(req, res, startedAt), {
        accountability: req.accountability,
        requestId: req.id,
      }).catch(() => {});
    });
    next();
  };
}

export function createApp({
  pool,
  config,
  logger = console,
  serviceRegistry = createCoreServiceRegistry(),
  schemaCache = null,
  permissionCache = null,
  emitter = null,
  storage = null,
  mailer = null,
  rateLimitStore = null,
  redisClient = null,
  externalAuthRegistry = null,
  endpointExtensions = [],
  aiRouter = null,
  mcpRouter = null,
  studioRoot = undefined,
}) {
  if (!pool) throw new Error('Database pool is required');
  if (!config) throw new Error('Config is required');
  if (!Array.isArray(endpointExtensions)) throw new Error('endpointExtensions must be an array');

  const services = serviceRegistry.toObject();
  const app = express();
  app.disable('x-powered-by');
  if (config.server?.trustProxyHops > 0) app.set('trust proxy', config.server.trustProxyHops);
  app.use(securityHeaders);
  app.use(studioCors(config));
  app.use(requestIdentity);
  app.use(express.json({ limit: '1mb' }));

  app.get('/health', (req, res) => {
    res.json({ status: 'ok', request_id: req.id });
  });

  app.get('/ready', async (req, res) => {
    const failures = [];
    try {
      const ready = await pingDatabase(pool);
      if (!ready) failures.push({ code: 'DATABASE_UNAVAILABLE', message: 'Database is not ready' });
    } catch {
      failures.push({ code: 'DATABASE_UNAVAILABLE', message: 'Database is not ready' });
    }
    if (config.redis?.required && redisClient) {
      try {
        if (!await redisClient.ping()) throw new Error('Unexpected Redis ping result');
      } catch {
        failures.push({ code: 'SHARED_STATE_UNAVAILABLE', message: 'Required shared state is not ready' });
      }
    }
    if (failures.length) {
      logger.warn?.('YunCMS readiness check failed', { requestId: req.id, failures: failures.map((entry) => entry.code) });
      return res.status(503).json({ status: 'not_ready', request_id: req.id, errors: failures });
    }
    return res.json({
      status: 'ready',
      request_id: req.id,
      shared_state: {
        cache: config.cache?.store ?? 'memory',
        api_rate_limit: config.server?.rateLimit?.store ?? 'memory',
        auth_rate_limit: config.auth?.rateLimit?.store ?? 'memory',
      },
    });
  });

  app.use(createStudioMiddleware({ root: studioRoot }));
  const pressureLimit = createPressureLimit(config.server?.pressure);
  if (pressureLimit) app.use(pressureLimit);
  const apiRateLimit = createApiRateLimit(config, rateLimitStore, logger);
  if (apiRateLimit) app.use(apiRateLimit);

  app.use(createAuthenticationMiddleware({ pool, config, logger, services, schemaCache, permissionCache, emitter, storage }));
  const requestEvents = createRequestEvents(emitter);
  if (requestEvents) app.use(requestEvents);

  if (aiRouter) app.use('/ai', aiRouter);
  if (mcpRouter) app.use('/mcp', mcpRouter);
  app.use('/studio-navigation', createStudioNavigationRouter());
  app.use('/studio-settings', createStudioSettingsRouter());
  app.use('/auth', createAuthRouter({ mailer, config, logger, rateLimitStore, externalAuthRegistry }));
  app.use('/items', createItemsRouter());
  app.use('/schema', createSystemSchemaRouter({ schemaCache }));
  app.use('/schema', createSchemaRouter({ schemaCache }));
  app.use('/users', createUsersRouter());
  app.use('/roles', createRolesRouter());
  app.use('/permissions', createPermissionsRouter());
  app.use('/files', createFilesRouter({ maxUploadBytes: config.storage?.maxUploadBytes }));
  app.use('/audit', createAuditRouter());

  for (const extension of endpointExtensions) {
    if (!extension?.id || !extension?.router) throw new Error('Invalid endpoint extension runtime entry');
    app.use(`/extensions/${encodeURIComponent(extension.id)}`, extension.router);
  }

  app.use((req, res) => {
    res.status(404).json({ errors: [{ code: 'NOT_FOUND', message: 'Route not found', request_id: req.id }] });
  });
  app.use((error, req, res, next) => {
    if (emitter) {
      emitter.action('request.failed', {
        ...requestEventMetadata(req, res, Date.now()),
        error: { code: error?.code ?? 'INTERNAL_ERROR' },
      }, { accountability: req.accountability, requestId: req.id }).catch(() => {});
    }
    next(error);
  });
  app.use(apiErrorHandler(logger));
  return app;
}

export {
  CONTENT_SECURITY_POLICY,
  createApiRateLimit,
  createRequestEvents,
  requestIdentity,
  securityHeaders,
  studioCors,
};
